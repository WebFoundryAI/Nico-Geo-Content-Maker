/**
 * Patch Applier
 *
 * Transforms improvement plan patches into file content ready for GitHub write-back.
 * Supports additive updates only - never deletes or overwrites blindly.
 *
 * DESIGN CONSTRAINTS:
 * - Maps patches to file paths deterministically
 * - Additive operations only (append, not replace)
 * - Includes TODO markers for human review points
 * - Never guesses file paths - requires explicit mapping
 * - Preserves existing content when updating
 */

import type { PageImprovementPlan, SuggestedFAQ, SuggestedSchema } from '../analyze/improvementPlanner';
import type {
  GitHubClientConfig,
  CommitResult,
} from './githubClient';
import {
  getFileContents,
  decodeContent,
  batchUpsertFiles,
} from './githubClient';

/**
 * Mapping of site URL paths to repository file paths.
 * Required for deterministic patch application.
 */
export interface PathMapping {
  urlPath: string; // e.g., "/services" or "/about"
  filePath: string; // e.g., "src/pages/services.astro" or "content/about.md"
  fileType: 'astro' | 'html' | 'markdown' | 'json';
}

/**
 * Configuration for patch application.
 */
export interface PatchApplierConfig {
  pathMappings: PathMapping[];
  schemaOutputPath?: string; // Default path for schema.json output
  patchOutputDir?: string; // Directory for patch files if direct injection isn't possible
  dryRun?: boolean; // If true, don't actually write, just return what would be written
}

/**
 * A single file patch ready for write-back.
 */
export interface FilePatch {
  path: string;
  content: string;
  message: string;
  operation: 'create' | 'update' | 'append';
  humanReviewRequired: boolean;
  reviewNotes: string[];
}

/**
 * Result of patch application.
 */
export interface PatchApplicationResult {
  success: boolean;
  patchesGenerated: number;
  patchesApplied: number;
  commits: CommitResult[];
  patches: FilePatch[];
  errors: string[];
  warnings: string[];
}

/**
 * Extracts the URL path from a full URL.
 */
function extractUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url;
  }
}

/**
 * Finds the path mapping for a given URL.
 */
function findPathMapping(url: string, mappings: PathMapping[]): PathMapping | null {
  const urlPath = extractUrlPath(url);

  // Exact match first
  const exact = mappings.find(m => m.urlPath === urlPath);
  if (exact) return exact;

  // Normalize paths for comparison (remove trailing slashes)
  const normalizedPath = urlPath.replace(/\/$/, '') || '/';
  const normalized = mappings.find(
    m => m.urlPath.replace(/\/$/, '') === normalizedPath
  );
  if (normalized) return normalized;

  return null;
}

/**
 * Generates meta tag content block for injection.
 */
function generateMetaBlock(
  recommendedTitle: string | null,
  recommendedMetaDescription: string | null
): string {
  const lines: string[] = [];
  lines.push('<!-- GEO IMPROVEMENT: Meta Tags -->');
  lines.push('<!-- TODO: Review and customize these recommendations -->');

  if (recommendedTitle) {
    lines.push(`<!-- Recommended Title: ${recommendedTitle} -->`);
  }
  if (recommendedMetaDescription) {
    lines.push(`<!-- Recommended Meta Description: ${recommendedMetaDescription} -->`);
  }

  lines.push('<!-- END GEO IMPROVEMENT -->');
  return lines.join('\n');
}

/**
 * Generates an answer capsule block for injection.
 */
function generateAnswerCapsuleBlock(capsule: string): string {
  const lines: string[] = [];
  lines.push('<!-- GEO IMPROVEMENT: Answer Capsule -->');
  lines.push('<!-- TODO: Review, customize, and position appropriately -->');
  lines.push('<div class="geo-answer-capsule">');
  lines.push(`  <p>${escapeHtml(capsule)}</p>`);
  lines.push('</div>');
  lines.push('<!-- END GEO IMPROVEMENT -->');
  return lines.join('\n');
}

/**
 * Generates FAQ section HTML block.
 */
function generateFAQBlock(faqs: SuggestedFAQ[]): string {
  const lines: string[] = [];
  lines.push('<!-- GEO IMPROVEMENT: FAQ Section -->');
  lines.push('<!-- TODO: Review and verify all FAQ content before publishing -->');
  lines.push('<section class="geo-faq" itemscope itemtype="https://schema.org/FAQPage">');
  lines.push('  <h2>Frequently Asked Questions</h2>');

  for (const faq of faqs) {
    const placeholderNote = faq.isPlaceholder ? ' <!-- PLACEHOLDER: Requires real data -->' : '';
    lines.push(`  <div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">${placeholderNote}`);
    lines.push(`    <h3 itemprop="name">${escapeHtml(faq.question)}</h3>`);
    lines.push(`    <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">`);
    lines.push(`      <p itemprop="text">${escapeHtml(faq.answer)}</p>`);
    lines.push(`    </div>`);
    lines.push(`  </div>`);
  }

  lines.push('</section>');
  lines.push('<!-- END GEO IMPROVEMENT -->');
  return lines.join('\n');
}

/**
 * Generates schema.org JSON-LD block.
 */
function generateSchemaBlock(schema: SuggestedSchema): string {
  const lines: string[] = [];
  lines.push('<!-- GEO IMPROVEMENT: Schema.org JSON-LD -->');
  lines.push('<!-- TODO: Verify all placeholder values before publishing -->');
  lines.push('<script type="application/ld+json">');
  lines.push(JSON.stringify(schema, null, 2));
  lines.push('</script>');
  lines.push('<!-- END GEO IMPROVEMENT -->');
  return lines.join('\n');
}

/**
 * Escapes HTML special characters.
 */
function escapeHtml(text: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, char => entities[char] || char);
}

/**
 * Generates a complete patch file for a page.
 * This creates a standalone patch file when direct injection isn't possible.
 */
function generatePatchFile(improvement: PageImprovementPlan): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push('/**');
  lines.push(` * GEO Improvement Patch`);
  lines.push(` * Generated: ${timestamp}`);
  lines.push(` * Target URL: ${improvement.url}`);
  lines.push(` * Estimated Impact: ${improvement.estimatedImpact}`);
  lines.push(' *');
  lines.push(' * TODO: Review all suggestions before applying');
  lines.push(' * TODO: Replace [ADD ...] placeholders with real data');
  lines.push(' */');
  lines.push('');

  // Current state summary
  lines.push('/* CURRENT STATE */');
  lines.push(`// Title: ${improvement.currentState.title || '(missing)'}`);
  lines.push(`// Meta Description: ${improvement.currentState.metaDescription || '(missing)'}`);
  lines.push(`// H1: ${improvement.currentState.h1 || '(missing)'}`);
  lines.push(`// Has Schema: ${improvement.currentState.hasSchema}`);
  lines.push(`// Content Length: ${improvement.currentState.contentLength}`);
  lines.push('');

  // Recommended changes
  if (improvement.recommendedTitle) {
    lines.push('/* RECOMMENDED TITLE */');
    lines.push(`// ${improvement.recommendedTitle}`);
    lines.push('');
  }

  if (improvement.recommendedMetaDescription) {
    lines.push('/* RECOMMENDED META DESCRIPTION */');
    lines.push(`// ${improvement.recommendedMetaDescription}`);
    lines.push('');
  }

  // Priority actions
  if (improvement.priorityActions.length > 0) {
    lines.push('/* PRIORITY ACTIONS */');
    for (const action of improvement.priorityActions) {
      lines.push(`// - ${action}`);
    }
    lines.push('');
  }

  // Suggested additions
  if (improvement.suggestedAdditions.answerCapsule) {
    lines.push('/* ANSWER CAPSULE HTML */');
    lines.push('/*');
    lines.push(generateAnswerCapsuleBlock(improvement.suggestedAdditions.answerCapsule));
    lines.push('*/');
    lines.push('');
  }

  if (improvement.suggestedAdditions.faq) {
    lines.push('/* FAQ SECTION HTML */');
    lines.push('/*');
    lines.push(generateFAQBlock(improvement.suggestedAdditions.faq));
    lines.push('*/');
    lines.push('');
  }

  if (improvement.suggestedAdditions.schemaJsonLd) {
    lines.push('/* SCHEMA.ORG JSON-LD */');
    lines.push('/*');
    lines.push(generateSchemaBlock(improvement.suggestedAdditions.schemaJsonLd));
    lines.push('*/');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generates patches for all improvements in a plan.
 */
export function generatePatches(
  improvements: PageImprovementPlan[],
  config: PatchApplierConfig
): FilePatch[] {
  const patches: FilePatch[] = [];
  const patchDir = config.patchOutputDir || 'geo-patches';

  // Sort improvements by URL for deterministic output
  const sortedImprovements = [...improvements].sort((a, b) =>
    a.url.localeCompare(b.url)
  );

  for (const improvement of sortedImprovements) {
    // Skip if no improvements suggested
    const hasImprovements =
      improvement.recommendedTitle ||
      improvement.recommendedMetaDescription ||
      Object.keys(improvement.suggestedAdditions).length > 0;

    if (!hasImprovements) continue;

    const mapping = findPathMapping(improvement.url, config.pathMappings);
    const reviewNotes: string[] = [];

    // Check for placeholders requiring human review
    const hasPlaceholders =
      (improvement.recommendedTitle?.includes('[ADD') ?? false) ||
      (improvement.recommendedMetaDescription?.includes('[ADD') ?? false) ||
      (improvement.suggestedAdditions.answerCapsule?.includes('[ADD') ?? false) ||
      (improvement.suggestedAdditions.faq?.some(f => f.isPlaceholder) ?? false) ||
      (JSON.stringify(improvement.suggestedAdditions.schemaJsonLd || {}).includes('[ADD'));

    if (hasPlaceholders) {
      reviewNotes.push('Contains placeholder values that require real data');
    }

    if (mapping) {
      // Direct injection possible - create content block
      const blocks: string[] = [];

      if (improvement.recommendedTitle || improvement.recommendedMetaDescription) {
        blocks.push(generateMetaBlock(
          improvement.recommendedTitle,
          improvement.recommendedMetaDescription
        ));
      }

      if (improvement.suggestedAdditions.answerCapsule) {
        blocks.push(generateAnswerCapsuleBlock(improvement.suggestedAdditions.answerCapsule));
      }

      if (improvement.suggestedAdditions.faq) {
        blocks.push(generateFAQBlock(improvement.suggestedAdditions.faq));
      }

      if (improvement.suggestedAdditions.schemaJsonLd) {
        blocks.push(generateSchemaBlock(improvement.suggestedAdditions.schemaJsonLd));
      }

      patches.push({
        path: mapping.filePath,
        content: blocks.join('\n\n'),
        message: `GEO improvement: ${extractUrlPath(improvement.url)}`,
        operation: 'append',
        humanReviewRequired: hasPlaceholders,
        reviewNotes,
      });
    } else {
      // No mapping - create standalone patch file
      const urlPath = extractUrlPath(improvement.url);
      const safeFileName = urlPath
        .replace(/^\//, '')
        .replace(/\//g, '-')
        .replace(/[^a-zA-Z0-9-]/g, '') || 'index';

      patches.push({
        path: `${patchDir}/${safeFileName}.patch.js`,
        content: generatePatchFile(improvement),
        message: `GEO patch: ${urlPath}`,
        operation: 'create',
        humanReviewRequired: true,
        reviewNotes: [
          'No direct file mapping found - manual application required',
          ...reviewNotes,
        ],
      });
    }
  }

  return patches;
}

/**
 * Applies patches to the target repository.
 *
 * When dryRun is true, returns what would be written without actually writing.
 * When a file already exists and operation is 'append', content is appended.
 */
export async function applyPatches(
  config: GitHubClientConfig,
  patches: FilePatch[],
  dryRun: boolean = false
): Promise<PatchApplicationResult> {
  const result: PatchApplicationResult = {
    success: true,
    patchesGenerated: patches.length,
    patchesApplied: 0,
    commits: [],
    patches,
    errors: [],
    warnings: [],
  };

  if (patches.length === 0) {
    result.warnings.push('No patches to apply');
    return result;
  }

  if (dryRun) {
    result.warnings.push('Dry run mode - no files were written');
    return result;
  }

  // Sort patches for deterministic commit ordering
  const sortedPatches = [...patches].sort((a, b) => a.path.localeCompare(b.path));

  // Prepare files for batch upsert
  const filesToWrite: Array<{ path: string; content: string; message: string }> = [];

  for (const patch of sortedPatches) {
    try {
      let finalContent = patch.content;

      if (patch.operation === 'append') {
        // Get existing content and append
        const existing = await getFileContents(config, patch.path);
        if (existing) {
          const existingContent = decodeContent(existing.content);
          finalContent = existingContent + '\n\n' + patch.content;
        }
      }

      filesToWrite.push({
        path: patch.path,
        content: finalContent,
        message: patch.message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Failed to prepare ${patch.path}: ${message}`);
    }
  }

  // Apply all patches
  try {
    const commits = await batchUpsertFiles(config, filesToWrite);
    result.commits = commits;
    result.patchesApplied = commits.length;
  } catch (err) {
    result.success = false;
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Batch write failed: ${message}`);
  }

  return result;
}

/**
 * Convenience function to generate and apply patches in one step.
 */
export async function generateAndApplyPatches(
  githubConfig: GitHubClientConfig,
  improvements: PageImprovementPlan[],
  patchConfig: PatchApplierConfig
): Promise<PatchApplicationResult> {
  const patches = generatePatches(improvements, patchConfig);
  return applyPatches(githubConfig, patches, patchConfig.dryRun);
}
