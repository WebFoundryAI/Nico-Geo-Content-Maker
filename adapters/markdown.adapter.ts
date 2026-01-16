/**
 * Markdown Adapter
 *
 * Converts GEO pipeline output into readable Markdown format
 * with proper headings and sections.
 *
 * DESIGN: Transforms structured JSON into human-readable documentation.
 * Fails loudly if required content blocks are missing.
 */

import type { GEOPipelineOutput } from '../core/pipeline/geoPipeline';

/**
 * Converts GEO pipeline output to Markdown format.
 *
 * @param output - The aggregated GEO pipeline output
 * @returns Formatted Markdown string
 */
export function toMarkdown(output: GEOPipelineOutput): string {
  // Validate required blocks
  validateRequiredBlocks(output);

  const sections: string[] = [];

  // Header with metadata
  sections.push(`# GEO Content Output`);
  sections.push('');
  sections.push(`**Business:** ${output.metadata.businessName}`);
  sections.push(`**Generated:** ${output.metadata.generatedAt}`);
  sections.push(`**Pipeline Version:** ${output.metadata.pipelineVersion}`);
  sections.push('');

  // Title & Meta section
  sections.push('---');
  sections.push('');
  sections.push('## Title & Meta');
  sections.push('');
  sections.push(`**Title:** ${output.titleMeta.title}`);
  sections.push('');
  sections.push(`**Meta Description:** ${output.titleMeta.metaDescription}`);
  if (output.titleMeta.ogTitle) {
    sections.push('');
    sections.push(`**OG Title:** ${output.titleMeta.ogTitle}`);
  }
  if (output.titleMeta.ogDescription) {
    sections.push('');
    sections.push(`**OG Description:** ${output.titleMeta.ogDescription}`);
  }
  sections.push('');

  // Answer Capsule section
  sections.push('---');
  sections.push('');
  sections.push('## Answer Capsule');
  sections.push('');
  sections.push(output.answerCapsule.capsule);
  sections.push('');
  sections.push('### Structured Answer');
  sections.push('');
  sections.push(`- **Entity:** ${output.answerCapsule.structuredAnswer.entity}`);
  sections.push(`- **Location:** ${output.answerCapsule.structuredAnswer.location}`);
  sections.push(`- **Primary Offering:** ${output.answerCapsule.structuredAnswer.primaryOffering}`);
  if (output.answerCapsule.structuredAnswer.proofPoint) {
    sections.push(`- **Proof Point:** ${output.answerCapsule.structuredAnswer.proofPoint}`);
  }
  sections.push('');

  // Service Descriptions section
  sections.push('---');
  sections.push('');
  sections.push('## Service Descriptions');
  sections.push('');
  sections.push(`Total Services: ${output.serviceDescriptions.summary.totalServices} (${output.serviceDescriptions.summary.primaryCount} primary, ${output.serviceDescriptions.summary.secondaryCount} secondary)`);
  sections.push('');

  for (const service of output.serviceDescriptions.services) {
    const badge = service.isPrimary ? '**[Primary]**' : '*[Secondary]*';
    sections.push(`### ${service.serviceName} ${badge}`);
    sections.push('');
    sections.push(service.description);
    sections.push('');
    if (service.credentials && service.credentials.length > 0) {
      sections.push('**Credentials:**');
      for (const cred of service.credentials) {
        sections.push(`- ${cred}`);
      }
      sections.push('');
    }
  }

  // FAQ section
  sections.push('---');
  sections.push('');
  sections.push('## Frequently Asked Questions');
  sections.push('');

  if (output.faq.schemaReady.length > 0) {
    for (const faq of output.faq.schemaReady) {
      sections.push(`### ${faq.question}`);
      sections.push('');
      sections.push(faq.answer);
      sections.push('');
      sections.push(`*Category: ${faq.category}*`);
      sections.push('');
    }
  } else {
    sections.push('*No FAQs could be generated from available data.*');
    sections.push('');
  }

  if (output.faq.unanswerable.length > 0) {
    sections.push('### Unanswerable Questions');
    sections.push('');
    sections.push('The following questions could not be answered due to missing data:');
    sections.push('');
    for (const q of output.faq.unanswerable) {
      sections.push(`- ${q}`);
    }
    sections.push('');
  }

  // Schema section
  sections.push('---');
  sections.push('');
  sections.push('## Schema.org (JSON-LD)');
  sections.push('');
  sections.push('```json');
  sections.push(output.schema.jsonLd);
  sections.push('```');
  sections.push('');

  if (output.schema.validationNotes.length > 0) {
    sections.push('### Validation Notes');
    sections.push('');
    for (const note of output.schema.validationNotes) {
      sections.push(`- ${note}`);
    }
    sections.push('');
  }

  // Sources section
  sections.push('---');
  sections.push('');
  sections.push('## Sources');
  sections.push('');
  for (const source of output.allSources) {
    sections.push(`- ${source}`);
  }
  sections.push('');

  return sections.join('\n');
}

/**
 * Validates that required content blocks are present.
 * Fails loudly if any are missing.
 */
function validateRequiredBlocks(output: GEOPipelineOutput): void {
  if (!output) {
    throw new Error('Markdown Adapter: Output is required');
  }

  if (!output.metadata) {
    throw new Error('Markdown Adapter: Missing required content block: metadata');
  }

  if (!output.titleMeta) {
    throw new Error('Markdown Adapter: Missing required content block: titleMeta');
  }

  if (!output.answerCapsule) {
    throw new Error('Markdown Adapter: Missing required content block: answerCapsule');
  }

  if (!output.serviceDescriptions) {
    throw new Error('Markdown Adapter: Missing required content block: serviceDescriptions');
  }

  if (!output.faq) {
    throw new Error('Markdown Adapter: Missing required content block: faq');
  }

  if (!output.schema) {
    throw new Error('Markdown Adapter: Missing required content block: schema');
  }
}
