/**
 * Title & Meta Generator
 *
 * Generates SEO-optimized title tags and meta descriptions
 * for GEO content based on BusinessInput data.
 *
 * PROMPT LOGIC:
 * - Title should include business name + primary service + location
 * - Meta description should summarize value proposition with location context
 * - Character limits: title ~60 chars, description ~155 chars
 * - No fabricated claims, awards, or statistics
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
  missingDataPlaceholder,
} from '../rules/antiHallucination';

export interface TitleMetaOutput {
  title: string;
  metaDescription: string;
  ogTitle?: string;
  ogDescription?: string;
  sources: string[];
}

/**
 * Generates title and meta description from BusinessInput.
 * Only uses explicitly provided data - never infers or fabricates.
 */
export function generateTitleMeta(input: BusinessInput): TitleMetaOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { business, location, services } = input;

  // Build title from available data
  // PROMPT LOGIC: Combine business name + primary service + city
  const titleParts: string[] = [];

  if (hasValue(business.name)) {
    titleParts.push(business.name);
  } else {
    titleParts.push(missingDataPlaceholder('business.name'));
  }

  if (hasItems(services.primary)) {
    // Use first primary service
    titleParts.push(services.primary[0]);
  }

  if (hasValue(location.primaryCity)) {
    titleParts.push(`in ${location.primaryCity}`);
  }

  const title = titleParts.join(' | ');

  // Build meta description from available data
  // PROMPT LOGIC: Value proposition with location and service context
  const descParts: string[] = [];

  if (hasValue(business.name) && hasItems(services.primary)) {
    descParts.push(
      `${business.name} provides ${services.primary.join(', ')}`
    );
  }

  if (hasValue(location.primaryCity) && hasValue(location.country)) {
    descParts.push(`in ${location.primaryCity}, ${location.country}`);
  } else if (hasValue(location.primaryCity)) {
    descParts.push(`in ${location.primaryCity}`);
  }

  if (hasItems(location.serviceAreas) && location.serviceAreas.length > 1) {
    descParts.push(`Serving ${location.serviceAreas.join(', ')}`);
  }

  const metaDescription = descParts.join('. ') + '.';

  return {
    title,
    metaDescription,
    ogTitle: title,
    ogDescription: metaDescription,
    sources: ['BusinessInput'],
  };
}
