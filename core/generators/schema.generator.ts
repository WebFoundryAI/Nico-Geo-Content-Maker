/**
 * Schema.org Generator
 *
 * Generates structured data markup (JSON-LD) for
 * LocalBusiness and related schema.org types.
 *
 * PROMPT LOGIC:
 * - Generate valid JSON-LD for LocalBusiness schema
 * - Only include fields with verified data
 * - Omit optional schema fields when data is missing
 * - Never fabricate required schema properties
 * - Format for direct embedding in HTML head
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
  hasPositiveNumber,
} from '../rules/antiHallucination';

export interface LocalBusinessSchema {
  '@context': 'https://schema.org';
  '@type': 'LocalBusiness';
  name: string;
  url?: string;
  telephone?: string;
  email?: string;
  address?: {
    '@type': 'PostalAddress';
    addressLocality: string;
    addressRegion?: string;
    addressCountry: string;
  };
  areaServed?: Array<{
    '@type': 'City' | 'State' | 'AdministrativeArea';
    name: string;
  }>;
  hasOfferCatalog?: {
    '@type': 'OfferCatalog';
    name: string;
    itemListElement: Array<{
      '@type': 'Offer';
      itemOffered: {
        '@type': 'Service';
        name: string;
      };
    }>;
  };
  aggregateRating?: {
    '@type': 'AggregateRating';
    ratingValue: number;
    reviewCount: number;
  };
  openingHours?: string;
}

export interface SchemaOutput {
  localBusiness: LocalBusinessSchema;
  jsonLd: string;
  validationNotes: string[];
  sources: string[];
}

/**
 * Generates Schema.org structured data from BusinessInput.
 * Produces valid JSON-LD for LocalBusiness schema.
 */
export function generateSchema(input: BusinessInput): SchemaOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { business, location, contact, services, proof, operations } = input;
  const validationNotes: string[] = [];

  // Build base schema - name is required
  // PROMPT LOGIC: LocalBusiness requires name at minimum
  const schema: LocalBusinessSchema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: hasValue(business.name) ? business.name : '[BUSINESS_NAME_REQUIRED]',
  };

  if (!hasValue(business.name)) {
    validationNotes.push('WARNING: business.name is required for valid schema');
  }

  // Add URL if available
  if (hasValue(business.website)) {
    schema.url = business.website;
  } else if (hasValue(business.domain)) {
    schema.url = `https://${business.domain}`;
  }

  // Add contact info if available
  // PROMPT LOGIC: Only include verified contact details
  if (hasValue(contact)) {
    if (hasValue(contact.phone)) {
      schema.telephone = contact.phone;
    }
    if (hasValue(contact.email)) {
      schema.email = contact.email;
    }
  }

  // Add address if location data available
  // PROMPT LOGIC: Build PostalAddress only with verified location data
  if (hasValue(location.primaryCity) && hasValue(location.country)) {
    schema.address = {
      '@type': 'PostalAddress',
      addressLocality: location.primaryCity,
      addressCountry: location.country,
    };

    if (hasValue(location.region)) {
      schema.address.addressRegion = location.region;
    }
  } else {
    validationNotes.push('NOTE: Address incomplete - missing city or country');
  }

  // Add service areas if available
  // PROMPT LOGIC: Each service area as separate areaServed entry
  if (hasItems(location.serviceAreas)) {
    schema.areaServed = location.serviceAreas.map(area => ({
      '@type': 'City' as const,
      name: area,
    }));
  }

  // Add services catalog if available
  // PROMPT LOGIC: Structure services as OfferCatalog
  if (hasItems(services.primary)) {
    const allServices = [
      ...services.primary,
      ...(services.secondary ?? []),
    ];

    schema.hasOfferCatalog = {
      '@type': 'OfferCatalog',
      name: 'Services',
      itemListElement: allServices.map(serviceName => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: serviceName,
        },
      })),
    };
  }

  // Add aggregate rating only if both values provided
  // PROMPT LOGIC: Never fabricate ratings - both values required
  if (
    hasValue(proof) &&
    hasPositiveNumber(proof.averageRating) &&
    hasPositiveNumber(proof.reviewCount)
  ) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: proof.averageRating,
      reviewCount: proof.reviewCount,
    };
  }

  // Add opening hours if available
  if (hasValue(operations) && hasValue(operations.operatingHours)) {
    schema.openingHours = operations.operatingHours;
  }

  // Generate JSON-LD string
  const jsonLd = JSON.stringify(schema, null, 2);

  return {
    localBusiness: schema,
    jsonLd,
    validationNotes,
    sources: ['BusinessInput'],
  };
}
