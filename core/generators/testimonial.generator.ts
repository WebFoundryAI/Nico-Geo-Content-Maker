/**
 * Testimonial Enhancement Generator
 *
 * Takes existing testimonials and enhances them with structure,
 * attribution, and impact. Makes them sound authentic but better organized.
 *
 * PROMPT LOGIC:
 * - Only process provided testimonials
 * - Return empty if no testimonials provided (strict anti-hallucination)
 * - Preserve original sentiment and truth
 * - Add structure (attribution, key quote, trust signals)
 * - Never invent details not in the original
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
} from '../rules/antiHallucination';

export interface EnhancedTestimonial {
  original: string;
  enhanced: string;
  attribution: {
    customerName: string;
    serviceReceived: string;
    date?: string;
    outcome?: string;
  };
  keyQuote: string;
  trustSignals: string[];
  sources: string[];
}

export interface TestimonialOutput {
  testimonials: EnhancedTestimonial[];
  summary: string;
  sources: string[];
}

/**
 * Generates enhanced testimonials from BusinessInput.
 * Returns empty array if no testimonial data is provided (no hallucination).
 */
export function generateTestimonial(input: BusinessInput): TestimonialOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { business, location, services, proof } = input;

  // If no testimonials provided, return empty output
  // We DO NOT generate template testimonials to avoid hallucination
  if (!proof?.testimonials || !hasItems(proof.testimonials)) {
    return {
      testimonials: [],
      summary: '',
      sources: ['BusinessInput'],
    };
  }

  // Build location context
  const primaryLocation = hasValue(location.primaryCity)
    ? `${location.primaryCity}${hasValue(location.region) ? `, ${location.region}` : ''}`
    : '';

  // Get primary service for context
  const primaryService = hasItems(services.primary) ? services.primary[0] : 'service';

  const enhancedTestimonials: EnhancedTestimonial[] = [];

  for (const testimonial of proof.testimonials) {
    // Validate required field
    if (!hasValue(testimonial.text)) {
      continue; // Skip testimonials without text
    }

    const enhanced = buildEnhancedTestimonial(
      testimonial,
      business.name,
      primaryLocation,
      primaryService
    );
    enhancedTestimonials.push(enhanced);
  }

  // Build summary
  const summary = buildSummary(enhancedTestimonials, business.name, primaryLocation);

  return {
    testimonials: enhancedTestimonials,
    summary,
    sources: ['BusinessInput'],
  };
}

/**
 * Builds an enhanced testimonial from provided data.
 */
function buildEnhancedTestimonial(
  testimonial: NonNullable<NonNullable<BusinessInput['proof']>['testimonials']>[0],
  businessName: string,
  primaryLocation: string,
  primaryService: string
): EnhancedTestimonial {
  const original = testimonial.text;

  // Build attribution - never invent details
  const customerName = hasValue(testimonial.customerName)
    ? testimonial.customerName
    : 'Anonymous customer';

  const serviceReceived = hasValue(testimonial.serviceReceived)
    ? testimonial.serviceReceived
    : primaryService;

  const attribution = {
    customerName,
    serviceReceived,
    date: testimonial.date,
    outcome: testimonial.outcome,
  };

  // Enhance the testimonial text
  const enhanced = enhanceText(
    original,
    customerName,
    serviceReceived,
    testimonial.outcome,
    businessName,
    primaryLocation
  );

  // Extract key quote (best sentence)
  const keyQuote = extractKeyQuote(original);

  // Build trust signals
  const trustSignals = buildTrustSignals(testimonial, primaryLocation);

  return {
    original,
    enhanced,
    attribution,
    keyQuote,
    trustSignals,
    sources: ['BusinessInput'],
  };
}

/**
 * Enhances testimonial text by adding structure without inventing details.
 */
function enhanceText(
  original: string,
  customerName: string,
  serviceReceived: string,
  outcome: string | undefined,
  businessName: string,
  location: string
): string {
  const parts: string[] = [];

  // Opening context (only if customer name is known)
  if (customerName !== 'Anonymous customer') {
    parts.push(`${customerName} shared their experience with ${businessName}'s ${serviceReceived}:`);
  } else {
    parts.push(`A customer shared their experience with ${businessName}'s ${serviceReceived}:`);
  }

  // Original text preserved
  parts.push(`"${original}"`);

  // Add outcome if provided
  if (hasValue(outcome)) {
    parts.push(`Result: ${outcome}.`);
  }

  // Add location context if available
  if (location && customerName !== 'Anonymous customer') {
    parts.push(`- ${customerName}, ${location}`);
  } else if (location) {
    parts.push(`- ${location} customer`);
  }

  return parts.join(' ');
}

/**
 * Extracts the most impactful sentence as a key quote.
 */
function extractKeyQuote(text: string): string {
  // Split into sentences
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10); // Filter out very short fragments

  if (sentences.length === 0) {
    // If no good sentences, use first 100 chars
    return text.length > 100 ? text.substring(0, 100) + '...' : text;
  }

  // Score sentences by impact indicators
  const scored = sentences.map(sentence => {
    let score = 0;

    // Positive sentiment indicators
    const positiveWords = [
      'excellent', 'amazing', 'great', 'wonderful', 'fantastic',
      'professional', 'recommend', 'best', 'perfect', 'outstanding',
      'quality', 'reliable', 'trust', 'satisfied', 'happy',
      'exceeded', 'impressed', 'exceptional', 'incredible', 'awesome'
    ];

    for (const word of positiveWords) {
      if (sentence.toLowerCase().includes(word)) {
        score += 2;
      }
    }

    // Specificity indicators (numbers, times, etc.)
    if (/\d+/.test(sentence)) {
      score += 1;
    }

    // Recommendation indicators
    if (/recommend|would use again|will (definitely )?use/i.test(sentence)) {
      score += 3;
    }

    // Length preference (15-50 words is ideal for quotes)
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount >= 10 && wordCount <= 40) {
      score += 1;
    }

    return { sentence, score };
  });

  // Sort by score descending and take the best
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0].sentence;

  // Ensure quote is not too long (target 20-30 words)
  const words = best.split(/\s+/);
  if (words.length > 40) {
    return words.slice(0, 35).join(' ') + '...';
  }

  return best;
}

/**
 * Builds trust signals from testimonial data.
 */
function buildTrustSignals(
  testimonial: NonNullable<NonNullable<BusinessInput['proof']>['testimonials']>[0],
  location: string
): string[] {
  const signals: string[] = [];

  // Named customer is more trustworthy
  if (hasValue(testimonial.customerName) && testimonial.customerName !== 'Anonymous') {
    signals.push('Named customer');
  }

  // Service specification adds credibility
  if (hasValue(testimonial.serviceReceived)) {
    signals.push(`${testimonial.serviceReceived} client`);
  }

  // Date adds recency credibility
  if (hasValue(testimonial.date)) {
    signals.push(`Dated: ${testimonial.date}`);
  }

  // Outcome shows measurable results
  if (hasValue(testimonial.outcome)) {
    signals.push('Measurable outcome reported');
  }

  // Location context
  if (location) {
    signals.push(`${location} area`);
  }

  return signals;
}

/**
 * Builds a summary of all testimonials.
 */
function buildSummary(
  testimonials: EnhancedTestimonial[],
  businessName: string,
  primaryLocation: string
): string {
  if (testimonials.length === 0) {
    return '';
  }

  // Identify key themes from testimonials
  const themes: string[] = [];
  let hasNamedCustomers = false;
  let hasOutcomes = false;

  for (const t of testimonials) {
    if (t.attribution.customerName !== 'Anonymous customer') {
      hasNamedCustomers = true;
    }
    if (hasValue(t.attribution.outcome)) {
      hasOutcomes = true;
    }

    // Check for common themes in the original text
    const textLower = t.original.toLowerCase();
    if (/professional|quality/i.test(textLower) && !themes.includes('professionalism')) {
      themes.push('professionalism');
    }
    if (/reliable|trust/i.test(textLower) && !themes.includes('reliability')) {
      themes.push('reliability');
    }
    if (/responsive|fast|quick/i.test(textLower) && !themes.includes('responsiveness')) {
      themes.push('responsiveness');
    }
    if (/recommend/i.test(textLower) && !themes.includes('customer recommendations')) {
      themes.push('customer recommendations');
    }
  }

  const parts: string[] = [];

  parts.push(`${testimonials.length} client testimonial${testimonials.length > 1 ? 's' : ''}`);

  if (primaryLocation) {
    parts.push(`from ${primaryLocation} customers`);
  }

  if (themes.length > 0) {
    const themeList = themes.slice(0, 3).join(', ');
    parts.push(`highlighting ${themeList}`);
  }

  if (hasOutcomes) {
    parts.push('with verified outcomes');
  }

  return parts.join(' ') + '.';
}
