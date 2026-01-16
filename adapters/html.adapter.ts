/**
 * HTML Adapter
 *
 * Converts GEO pipeline output into clean, framework-agnostic HTML fragments.
 * No layout, styling, or scripts - just semantic HTML content.
 *
 * DESIGN: Produces embeddable HTML fragments suitable for any downstream system.
 * Fails loudly if required content blocks are missing.
 */

import type { GEOPipelineOutput } from '../core/pipeline/geoPipeline';

/**
 * Converts GEO pipeline output to HTML fragment format.
 *
 * @param output - The aggregated GEO pipeline output
 * @returns Clean HTML string (fragments only, no document wrapper)
 */
export function toHTML(output: GEOPipelineOutput): string {
  // Validate required blocks
  validateRequiredBlocks(output);

  const sections: string[] = [];

  // Header section
  sections.push('<!-- GEO Content Output -->');
  sections.push(`<!-- Generated: ${escapeHtml(output.metadata.generatedAt)} -->`);
  sections.push(`<!-- Pipeline Version: ${escapeHtml(output.metadata.pipelineVersion)} -->`);
  sections.push('');

  // Meta tags section (for head insertion)
  sections.push('<!-- Meta Tags -->');
  sections.push(`<title>${escapeHtml(output.titleMeta.title)}</title>`);
  sections.push(`<meta name="description" content="${escapeHtml(output.titleMeta.metaDescription)}">`);
  if (output.titleMeta.ogTitle) {
    sections.push(`<meta property="og:title" content="${escapeHtml(output.titleMeta.ogTitle)}">`);
  }
  if (output.titleMeta.ogDescription) {
    sections.push(`<meta property="og:description" content="${escapeHtml(output.titleMeta.ogDescription)}">`);
  }
  sections.push('');

  // Answer Capsule section
  sections.push('<!-- Answer Capsule -->');
  sections.push('<section class="geo-answer-capsule">');
  sections.push(`  <p>${escapeHtml(output.answerCapsule.capsule)}</p>`);
  sections.push('</section>');
  sections.push('');

  // Service Descriptions section
  sections.push('<!-- Service Descriptions -->');
  sections.push('<section class="geo-services">');
  sections.push(`  <h2>Services</h2>`);

  for (const service of output.serviceDescriptions.services) {
    const dataAttr = service.isPrimary ? 'data-service-type="primary"' : 'data-service-type="secondary"';
    sections.push(`  <article class="geo-service" ${dataAttr}>`);
    sections.push(`    <h3>${escapeHtml(service.serviceName)}</h3>`);
    sections.push(`    <p>${escapeHtml(service.description)}</p>`);

    if (service.credentials && service.credentials.length > 0) {
      sections.push('    <ul class="geo-credentials">');
      for (const cred of service.credentials) {
        sections.push(`      <li>${escapeHtml(cred)}</li>`);
      }
      sections.push('    </ul>');
    }

    sections.push('  </article>');
  }

  sections.push('</section>');
  sections.push('');

  // FAQ section
  sections.push('<!-- FAQ Section -->');
  sections.push('<section class="geo-faq">');
  sections.push('  <h2>Frequently Asked Questions</h2>');

  if (output.faq.schemaReady.length > 0) {
    sections.push('  <dl>');
    for (const faq of output.faq.schemaReady) {
      sections.push(`    <dt>${escapeHtml(faq.question)}</dt>`);
      sections.push(`    <dd>${escapeHtml(faq.answer)}</dd>`);
    }
    sections.push('  </dl>');
  } else {
    sections.push('  <p>No FAQs available.</p>');
  }

  sections.push('</section>');
  sections.push('');

  // Schema.org JSON-LD section
  sections.push('<!-- Schema.org JSON-LD -->');
  sections.push('<script type="application/ld+json">');
  sections.push(output.schema.jsonLd);
  sections.push('</script>');
  sections.push('');

  return sections.join('\n');
}

/**
 * Escapes HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return text.replace(/[&<>"']/g, char => htmlEntities[char] || char);
}

/**
 * Validates that required content blocks are present.
 * Fails loudly if any are missing.
 */
function validateRequiredBlocks(output: GEOPipelineOutput): void {
  if (!output) {
    throw new Error('HTML Adapter: Output is required');
  }

  if (!output.metadata) {
    throw new Error('HTML Adapter: Missing required content block: metadata');
  }

  if (!output.titleMeta) {
    throw new Error('HTML Adapter: Missing required content block: titleMeta');
  }

  if (!output.answerCapsule) {
    throw new Error('HTML Adapter: Missing required content block: answerCapsule');
  }

  if (!output.serviceDescriptions) {
    throw new Error('HTML Adapter: Missing required content block: serviceDescriptions');
  }

  if (!output.faq) {
    throw new Error('HTML Adapter: Missing required content block: faq');
  }

  if (!output.schema) {
    throw new Error('HTML Adapter: Missing required content block: schema');
  }
}
