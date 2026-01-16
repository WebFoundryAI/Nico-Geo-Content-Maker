/**
 * Patch Applier
 *
 * Transforms improvement plan patches into file content ready for GitHub write-back.
 * Supports idempotent updates using marker-based content replacement.
 *
 * DESIGN CONSTRAINTS:
 * - Maps patches to file paths deterministically via pathContract
 * - Idempotent: uses marker comments to replace existing blocks
 * - Additive: only inserts new blocks, never deletes unrelated content
 * - Includes TODO markers for human review points
 * - Produces unified diff previews for planned changes
 *
 * MARKER FORMAT:
 * <!-- nico-geo:block:{blockType}:start -->
 * ... content ...
 * <!-- nico-geo:block:{blockType}:end -->
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
import {
  mapUrlToFilePath,
  PathContractConfig,
  PathMappingResult,
  PathMappingError,
} from './pathContract';

/**
 * Block types for marker-based content injection.
 */
export type BlockType = 'meta' | 'answer-capsule' | 'faq' | 'schema';

/**
 * Maximum diff preview length in characters.
 */
const MAX_DIFF_LENGTH = 10000;

/**
 * Creates the start marker for a block.
 */
function startMarker(blockType: BlockType): string {
  return `<!-- nico-geo:block:${blockType}:start -->`;
}

/**
 * Creates the end marker for a block.
 */
function endMarker(blockType: BlockType): string {
  return `<!-- nico-geo:block:${blockType}:end -->`;
}

/**
 * Wraps content with idempotency markers.
 */
function wrapWithMarkers(content: string, blockType: BlockType): string {
  return `${startMarker(blockType)}\n${content}\n${endMarker(blockType)}`;
}

/**
 * Checks if content contains markers for a specific block type.
 */
function hasMarkers(content: string, blockType: BlockType): boolean {
  return content.includes(startMarker(blockType)) && content.includes(endMarker(blockType));
}

/**
 * Replaces content within existing markers, or returns null if markers not found.
 */
function replaceWithinMarkers(
  existingContent: string,
  newBlockContent: string,
  blockType: BlockType
): string | null {
  const start = startMarker(blockType);
  const end = endMarker(blockType);

  const startIdx = existingContent.indexOf(start);
  const endIdx = existingContent.indexOf(end);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return null; // Markers not found or invalid
  }

  // Replace everything between markers (inclusive of markers)
  const before = existingContent.slice(0, startIdx);
  const after = existingContent.slice(endIdx + end.length);
  const wrappedContent = wrapWithMarkers(newBlockContent, blockType);

  return before + wrappedContent + after;
}

/**
 * Finds the best insertion point in HTML/Astro content.
 * Priority: before </main>, before </body>, or append at end.
 */
function findInsertionPoint(content: string): number {
  // Try to find </main>
  const mainCloseIdx = content.lastIndexOf('</main>');
  if (mainCloseIdx !== -1) {
    return mainCloseIdx;
  }

  // Try to find </body>
  const bodyCloseIdx = content.lastIndexOf('</body>');
  if (bodyCloseIdx !== -1) {
    return bodyCloseIdx;
  }

  // Fall back to end of content
  return content.length;
}

/**
 * Inserts a block at the appropriate location in content.
 */
function insertBlock(
  existingContent: string,
  newBlockContent: string,
  blockType: BlockType
): string {
  const wrappedContent = wrapWithMarkers(newBlockContent, blockType);
  const insertionPoint = findInsertionPoint(existingContent);

  // Add newlines for clean formatting
  const before = existingContent.slice(0, insertionPoint);
  const after = existingContent.slice(insertionPoint);

  return before + '\n\n' + wrappedContent + '\n\n' + after;
}

/**
 * Applies a block to content idempotently.
 * If markers exist, replaces content within. Otherwise, inserts at appropriate location.
 */
function applyBlockIdempotent(
  existingContent: string,
  newBlockContent: string,
  blockType: BlockType
): string {
  // Try to replace within existing markers first
  const replaced = replaceWithinMarkers(existingContent, newBlockContent, blockType);
  if (replaced !== null) {
    return replaced;
  }

  // No existing markers - insert new block
  return insertBlock(existingContent, newBlockContent, blockType);
}

/**
 * Generates meta tag content block.
 */
function generateMetaBlock(
  recommendedTitle: string | null,
  recommendedMetaDescription: string | null
): string {
  const lines: string[] = [];
  lines.push('<!-- TODO: Review and customize these recommendations -->');

  if (recommendedTitle) {
    lines.push(`<!-- Recommended Title: ${escapeHtml(recommendedTitle)} -->`);
  }
  if (recommendedMetaDescription) {
    lines.push(`<!-- Recommended Meta Description: ${escapeHtml(recommendedMetaDescription)} -->`);
  }

  return lines.join('\n');
}

/**
 * Generates an answer capsule block.
 */
function generateAnswerCapsuleBlock(capsule: string): string {
  const lines: string[] = [];
  lines.push('<!-- TODO: Review, customize, and position appropriately -->');
  lines.push('<div class="geo-answer-capsule">');
  lines.push(`  <p>${escapeHtml(capsule)}</p>`);
  lines.push('</div>');
  return lines.join('\n');
}

/**
 * Generates FAQ section HTML block.
 */
function generateFAQBlock(faqs: SuggestedFAQ[]): string {
  const lines: string[] = [];
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
  return lines.join('\n');
}

/**
 * Generates schema.org JSON-LD block.
 */
function generateSchemaBlock(schema: SuggestedSchema): string {
  const lines: string[] = [];
  lines.push('<!-- TODO: Verify all placeholder values before publishing -->');
  lines.push('<script type="application/ld+json">');
  lines.push(JSON.stringify(schema, null, 2));
  lines.push('</script>');
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
 * Suggested schema type (re-exported for convenience).
 */
export interface SuggestedSchema {
  '@context': 'https://schema.org';
  '@type': string;
  [key: string]: unknown;
}

/**
 * A planned file change.
 */
export interface PlannedFileChange {
  url: string;
  filePath: string;
  action: 'create' | 'update' | 'no-op';
  originalContent: string | null;
  newContent: string;
  humanReviewRequired: boolean;
  reviewNotes: string[];
}

/**
 * Diff preview for a file change.
 */
export interface DiffPreview {
  filePath: string;
  action: 'create' | 'update' | 'no-op';
  diff: string;
  truncated: boolean;
}

/**
 * Configuration for patch planning.
 */
export interface PatchPlanConfig {
  pathContract: PathContractConfig;
  patchOutputDir?: string;
}

/**
 * Result of patch planning (before application).
 */
export interface PatchPlanResult {
  plannedChanges: PlannedFileChange[];
  diffPreviews: DiffPreview[];
  mappingErrors: Array<{ url: string; error: string }>;
  warnings: string[];
}

/**
 * Result of patch application.
 */
export interface PatchApplicationResult {
  success: boolean;
  patchesGenerated: number;
  patchesApplied: number;
  commits: CommitResult[];
  plannedChanges: PlannedFileChange[];
  diffPreviews: DiffPreview[];
  errors: string[];
  warnings: string[];
}

/**
 * Simple unified diff generator.
 * Produces a basic unified diff format without external dependencies.
 */
function generateUnifiedDiff(
  filePath: string,
  originalContent: string | null,
  newContent: string
): string {
  const lines: string[] = [];

  // Header
  if (originalContent === null) {
    lines.push(`--- /dev/null`);
    lines.push(`+++ b/${filePath}`);
  } else {
    lines.push(`--- a/${filePath}`);
    lines.push(`+++ b/${filePath}`);
  }

  // For creation, show all lines as added
  if (originalContent === null) {
    const newLines = newContent.split('\n');
    lines.push(`@@ -0,0 +1,${newLines.length} @@`);
    for (const line of newLines) {
      lines.push(`+${line}`);
    }
    return lines.join('\n');
  }

  // For updates, compute a simple line-by-line diff
  const oldLines = originalContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple LCS-based diff (minimal implementation)
  const diff = computeLineDiff(oldLines, newLines);

  // Group changes into hunks
  const hunks = groupIntoHunks(diff, oldLines.length, newLines.length);

  for (const hunk of hunks) {
    lines.push(hunk.header);
    lines.push(...hunk.lines);
  }

  return lines.join('\n');
}

/**
 * Represents a diff operation.
 */
interface DiffOp {
  type: 'keep' | 'delete' | 'insert';
  oldIdx?: number;
  newIdx?: number;
  line: string;
}

/**
 * Computes a simple line-based diff.
 */
function computeLineDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const ops: DiffOp[] = [];

  // Use a simple approach: find common prefix and suffix, then mark middle as changed
  // This is a simplified diff - a real implementation would use LCS

  let commonPrefixLen = 0;
  while (
    commonPrefixLen < oldLines.length &&
    commonPrefixLen < newLines.length &&
    oldLines[commonPrefixLen] === newLines[commonPrefixLen]
  ) {
    commonPrefixLen++;
  }

  let commonSuffixLen = 0;
  while (
    commonSuffixLen < oldLines.length - commonPrefixLen &&
    commonSuffixLen < newLines.length - commonPrefixLen &&
    oldLines[oldLines.length - 1 - commonSuffixLen] === newLines[newLines.length - 1 - commonSuffixLen]
  ) {
    commonSuffixLen++;
  }

  // Add common prefix as keep
  for (let i = 0; i < commonPrefixLen; i++) {
    ops.push({ type: 'keep', oldIdx: i, newIdx: i, line: oldLines[i] });
  }

  // Add deleted lines from middle
  for (let i = commonPrefixLen; i < oldLines.length - commonSuffixLen; i++) {
    ops.push({ type: 'delete', oldIdx: i, line: oldLines[i] });
  }

  // Add inserted lines from middle
  for (let i = commonPrefixLen; i < newLines.length - commonSuffixLen; i++) {
    ops.push({ type: 'insert', newIdx: i, line: newLines[i] });
  }

  // Add common suffix as keep
  for (let i = 0; i < commonSuffixLen; i++) {
    const oldIdx = oldLines.length - commonSuffixLen + i;
    const newIdx = newLines.length - commonSuffixLen + i;
    ops.push({ type: 'keep', oldIdx, newIdx, line: oldLines[oldIdx] });
  }

  return ops;
}

/**
 * Groups diff operations into hunks.
 */
function groupIntoHunks(
  ops: DiffOp[],
  oldLen: number,
  newLen: number
): Array<{ header: string; lines: string[] }> {
  const hunks: Array<{ header: string; lines: string[] }> = [];

  // Find ranges with changes
  let inChange = false;
  let changeStart = 0;
  const changeRanges: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== 'keep') {
      if (!inChange) {
        inChange = true;
        changeStart = Math.max(0, i - 3); // Include 3 lines of context
      }
    } else if (inChange) {
      // Check if we should end this hunk
      let foundMore = false;
      for (let j = i; j < Math.min(i + 6, ops.length); j++) {
        if (ops[j].type !== 'keep') {
          foundMore = true;
          break;
        }
      }
      if (!foundMore) {
        changeRanges.push({ start: changeStart, end: Math.min(i + 3, ops.length) });
        inChange = false;
      }
    }
  }

  if (inChange) {
    changeRanges.push({ start: changeStart, end: ops.length });
  }

  // If no changes, return empty
  if (changeRanges.length === 0) {
    return [];
  }

  // Create hunks from ranges
  for (const range of changeRanges) {
    const hunkOps = ops.slice(range.start, range.end);
    const lines: string[] = [];

    let oldStart = Infinity;
    let oldCount = 0;
    let newStart = Infinity;
    let newCount = 0;

    for (const op of hunkOps) {
      if (op.type === 'keep') {
        lines.push(` ${op.line}`);
        if (op.oldIdx !== undefined) {
          oldStart = Math.min(oldStart, op.oldIdx + 1);
          oldCount++;
        }
        if (op.newIdx !== undefined) {
          newStart = Math.min(newStart, op.newIdx + 1);
          newCount++;
        }
      } else if (op.type === 'delete') {
        lines.push(`-${op.line}`);
        if (op.oldIdx !== undefined) {
          oldStart = Math.min(oldStart, op.oldIdx + 1);
          oldCount++;
        }
      } else {
        lines.push(`+${op.line}`);
        if (op.newIdx !== undefined) {
          newStart = Math.min(newStart, op.newIdx + 1);
          newCount++;
        }
      }
    }

    if (oldStart === Infinity) oldStart = 1;
    if (newStart === Infinity) newStart = 1;

    hunks.push({
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      lines,
    });
  }

  return hunks;
}

/**
 * Truncates diff if it exceeds maximum length.
 */
function truncateDiff(diff: string): { diff: string; truncated: boolean } {
  if (diff.length <= MAX_DIFF_LENGTH) {
    return { diff, truncated: false };
  }

  const truncated = diff.slice(0, MAX_DIFF_LENGTH);
  return {
    diff: truncated + '\n... [diff truncated at ' + MAX_DIFF_LENGTH + ' characters]',
    truncated: true,
  };
}

/**
 * Plans patches for improvements using path contract and idempotent blocks.
 */
export function planPatches(
  improvements: PageImprovementPlan[],
  existingContents: Map<string, string | null>, // filePath -> content (null if doesn't exist)
  config: PatchPlanConfig
): PatchPlanResult {
  const plannedChanges: PlannedFileChange[] = [];
  const diffPreviews: DiffPreview[] = [];
  const mappingErrors: Array<{ url: string; error: string }> = [];
  const warnings: string[] = [];

  // Sort improvements for deterministic output
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

    // Map URL to file path
    let mapping: PathMappingResult;
    try {
      mapping = mapUrlToFilePath(improvement.url, config.pathContract);
    } catch (err) {
      if (err instanceof PathMappingError) {
        mappingErrors.push({ url: err.url, error: err.reason });
      } else {
        mappingErrors.push({ url: improvement.url, error: 'Unknown mapping error' });
      }
      continue;
    }

    const reviewNotes: string[] = [];
    const existingContent = existingContents.get(mapping.filePath) ?? null;

    // Start with existing content or empty
    let newContent = existingContent ?? getDefaultContent(mapping.fileExtension);

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

    // Apply blocks idempotently
    if (improvement.recommendedTitle || improvement.recommendedMetaDescription) {
      const metaBlock = generateMetaBlock(
        improvement.recommendedTitle,
        improvement.recommendedMetaDescription
      );
      newContent = applyBlockIdempotent(newContent, metaBlock, 'meta');
    }

    if (improvement.suggestedAdditions.answerCapsule) {
      const capsuleBlock = generateAnswerCapsuleBlock(improvement.suggestedAdditions.answerCapsule);
      newContent = applyBlockIdempotent(newContent, capsuleBlock, 'answer-capsule');
    }

    if (improvement.suggestedAdditions.faq && improvement.suggestedAdditions.faq.length > 0) {
      const faqBlock = generateFAQBlock(improvement.suggestedAdditions.faq);
      newContent = applyBlockIdempotent(newContent, faqBlock, 'faq');
    }

    if (improvement.suggestedAdditions.schemaJsonLd) {
      const schemaBlock = generateSchemaBlock(improvement.suggestedAdditions.schemaJsonLd);
      newContent = applyBlockIdempotent(newContent, schemaBlock, 'schema');
    }

    // Determine action
    let action: 'create' | 'update' | 'no-op';
    if (existingContent === null) {
      action = 'create';
    } else if (existingContent === newContent) {
      action = 'no-op';
    } else {
      action = 'update';
    }

    // Create planned change
    plannedChanges.push({
      url: improvement.url,
      filePath: mapping.filePath,
      action,
      originalContent: existingContent,
      newContent,
      humanReviewRequired: hasPlaceholders,
      reviewNotes,
    });

    // Generate diff preview
    const rawDiff = generateUnifiedDiff(mapping.filePath, existingContent, newContent);
    const { diff, truncated } = truncateDiff(rawDiff);
    diffPreviews.push({
      filePath: mapping.filePath,
      action,
      diff,
      truncated,
    });
  }

  return {
    plannedChanges,
    diffPreviews,
    mappingErrors,
    warnings,
  };
}

/**
 * Returns default content for a new file based on extension.
 */
function getDefaultContent(extension: string): string {
  if (extension === 'astro') {
    return `---
// GEO-generated page
---

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Title</title>
</head>
<body>
  <main>
    <!-- Content will be added here -->
  </main>
</body>
</html>
`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Title</title>
</head>
<body>
  <main>
    <!-- Content will be added here -->
  </main>
</body>
</html>
`;
}

/**
 * Applies planned patches to GitHub repository.
 */
export async function applyPlannedPatches(
  githubConfig: GitHubClientConfig,
  plannedChanges: PlannedFileChange[],
  dryRun: boolean = false
): Promise<PatchApplicationResult> {
  const result: PatchApplicationResult = {
    success: true,
    patchesGenerated: plannedChanges.length,
    patchesApplied: 0,
    commits: [],
    plannedChanges,
    diffPreviews: [], // Diff previews should be generated separately
    errors: [],
    warnings: [],
  };

  // Filter to only changes that need to be applied
  const changesToApply = plannedChanges.filter(c => c.action !== 'no-op');

  if (changesToApply.length === 0) {
    result.warnings.push('No changes to apply');
    return result;
  }

  if (dryRun) {
    result.warnings.push('Dry run mode - no files were written');
    return result;
  }

  // Sort for deterministic commit ordering
  const sortedChanges = [...changesToApply].sort((a, b) => a.filePath.localeCompare(b.filePath));

  // Prepare files for batch upsert
  const filesToWrite = sortedChanges.map(change => ({
    path: change.filePath,
    content: change.newContent,
    message: `GEO improvement: ${change.url}`,
  }));

  try {
    const commits = await batchUpsertFiles(githubConfig, filesToWrite);
    result.commits = commits;
    result.patchesApplied = commits.length;
  } catch (err) {
    result.success = false;
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Batch write failed: ${message}`);
  }

  return result;
}

// Legacy exports for backwards compatibility
export type { PathMapping as LegacyPathMapping } from './pathContract';

export interface PathMapping {
  urlPath: string;
  filePath: string;
  fileType: 'astro' | 'html' | 'markdown' | 'json';
}

export interface PatchApplierConfig {
  pathMappings: PathMapping[];
  schemaOutputPath?: string;
  patchOutputDir?: string;
  dryRun?: boolean;
}

export interface FilePatch {
  path: string;
  content: string;
  message: string;
  operation: 'create' | 'update' | 'append';
  humanReviewRequired: boolean;
  reviewNotes: string[];
}

/**
 * Legacy function for generating patches (maintained for backwards compatibility).
 */
export function generatePatches(
  improvements: PageImprovementPlan[],
  config: PatchApplierConfig
): FilePatch[] {
  // This is a simplified legacy wrapper
  const patches: FilePatch[] = [];
  const patchDir = config.patchOutputDir || 'geo-patches';

  for (const improvement of improvements) {
    const hasImprovements =
      improvement.recommendedTitle ||
      improvement.recommendedMetaDescription ||
      Object.keys(improvement.suggestedAdditions).length > 0;

    if (!hasImprovements) continue;

    // Find mapping
    const urlPath = extractUrlPath(improvement.url);
    const mapping = config.pathMappings.find(m =>
      m.urlPath === urlPath || m.urlPath.replace(/\/$/, '') === urlPath.replace(/\/$/, '')
    );

    const reviewNotes: string[] = [];
    const hasPlaceholders =
      (improvement.recommendedTitle?.includes('[ADD') ?? false) ||
      (improvement.recommendedMetaDescription?.includes('[ADD') ?? false);

    if (hasPlaceholders) {
      reviewNotes.push('Contains placeholder values that require real data');
    }

    if (mapping) {
      const blocks: string[] = [];

      if (improvement.recommendedTitle || improvement.recommendedMetaDescription) {
        blocks.push(wrapWithMarkers(
          generateMetaBlock(improvement.recommendedTitle, improvement.recommendedMetaDescription),
          'meta'
        ));
      }

      if (improvement.suggestedAdditions.answerCapsule) {
        blocks.push(wrapWithMarkers(
          generateAnswerCapsuleBlock(improvement.suggestedAdditions.answerCapsule),
          'answer-capsule'
        ));
      }

      if (improvement.suggestedAdditions.faq) {
        blocks.push(wrapWithMarkers(
          generateFAQBlock(improvement.suggestedAdditions.faq),
          'faq'
        ));
      }

      if (improvement.suggestedAdditions.schemaJsonLd) {
        blocks.push(wrapWithMarkers(
          generateSchemaBlock(improvement.suggestedAdditions.schemaJsonLd),
          'schema'
        ));
      }

      patches.push({
        path: mapping.filePath,
        content: blocks.join('\n\n'),
        message: `GEO improvement: ${urlPath}`,
        operation: 'append',
        humanReviewRequired: hasPlaceholders,
        reviewNotes,
      });
    } else {
      // No mapping - create patch file
      const safeFileName = urlPath
        .replace(/^\//, '')
        .replace(/\//g, '-')
        .replace(/[^a-zA-Z0-9-]/g, '') || 'index';

      patches.push({
        path: `${patchDir}/${safeFileName}.patch.js`,
        content: generatePatchFileContent(improvement),
        message: `GEO patch: ${urlPath}`,
        operation: 'create',
        humanReviewRequired: true,
        reviewNotes: ['No direct file mapping found - manual application required', ...reviewNotes],
      });
    }
  }

  return patches;
}

function extractUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url;
  }
}

function generatePatchFileContent(improvement: PageImprovementPlan): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push('/**');
  lines.push(` * GEO Improvement Patch`);
  lines.push(` * Generated: ${timestamp}`);
  lines.push(` * Target URL: ${improvement.url}`);
  lines.push(' */');
  lines.push('');
  lines.push(`// Recommended Title: ${improvement.recommendedTitle || '(none)'}`);
  lines.push(`// Recommended Meta: ${improvement.recommendedMetaDescription || '(none)'}`);

  return lines.join('\n');
}

/**
 * Legacy apply patches function.
 */
export async function applyPatches(
  config: GitHubClientConfig,
  patches: FilePatch[],
  dryRun: boolean = false
): Promise<{
  success: boolean;
  patchesGenerated: number;
  patchesApplied: number;
  commits: CommitResult[];
  patches: FilePatch[];
  errors: string[];
  warnings: string[];
}> {
  const result = {
    success: true,
    patchesGenerated: patches.length,
    patchesApplied: 0,
    commits: [] as CommitResult[],
    patches,
    errors: [] as string[],
    warnings: [] as string[],
  };

  if (patches.length === 0) {
    result.warnings.push('No patches to apply');
    return result;
  }

  if (dryRun) {
    result.warnings.push('Dry run mode - no files were written');
    return result;
  }

  const sortedPatches = [...patches].sort((a, b) => a.path.localeCompare(b.path));

  const filesToWrite: Array<{ path: string; content: string; message: string }> = [];

  for (const patch of sortedPatches) {
    let finalContent = patch.content;

    if (patch.operation === 'append') {
      const existing = await getFileContents(config, patch.path);
      if (existing) {
        const existingContent = decodeContent(existing.content);
        // Use idempotent application
        finalContent = existingContent + '\n\n' + patch.content;
      }
    }

    filesToWrite.push({
      path: patch.path,
      content: finalContent,
      message: patch.message,
    });
  }

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
