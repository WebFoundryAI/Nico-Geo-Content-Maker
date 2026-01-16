/**
 * Service Description Generator
 *
 * Generates structured service descriptions for each service
 * offered by the business.
 *
 * PROMPT LOGIC:
 * - One description block per primary service
 * - Include location context for local SEO
 * - Reference credentials only if explicitly provided
 * - Secondary services listed as supplementary offerings
 * - No fabricated specializations or capabilities
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
  extractProvidedFields,
  missingDataPlaceholder,
} from '../rules/antiHallucination';

export interface ServiceDescriptionItem {
  serviceName: string;
  description: string;
  locationContext: string;
  credentials?: string[];
  isPrimary: boolean;
}

export interface ServiceDescriptionOutput {
  services: ServiceDescriptionItem[];
  summary: {
    totalServices: number;
    primaryCount: number;
    secondaryCount: number;
  };
  sources: string[];
}

/**
 * Generates service descriptions from BusinessInput.
 * Creates structured content for each service offering.
 */
export function generateServiceDescription(input: BusinessInput): ServiceDescriptionOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { business, location, services, credentials } = input;

  const serviceItems: ServiceDescriptionItem[] = [];

  // Build location context string
  // PROMPT LOGIC: Consistent location reference across all services
  const locationContext = hasValue(location.primaryCity)
    ? `${location.primaryCity}${hasValue(location.region) ? `, ${location.region}` : ''}`
    : missingDataPlaceholder('location.primaryCity');

  // Extract credentials if available - never fabricate
  const providedCredentials = extractProvidedFields(credentials);
  const credentialsList: string[] = [];

  if (providedCredentials) {
    if (hasItems(providedCredentials.licenses)) {
      credentialsList.push(...providedCredentials.licenses.map(l => `Licensed: ${l}`));
    }
    if (hasItems(providedCredentials.certifications)) {
      credentialsList.push(...providedCredentials.certifications.map(c => `Certified: ${c}`));
    }
    if (hasValue(providedCredentials.insurance)) {
      credentialsList.push(`Insured: ${providedCredentials.insurance}`);
    }
  }

  // Generate primary service descriptions
  // PROMPT LOGIC: Each primary service gets full treatment
  if (hasItems(services.primary)) {
    for (const serviceName of services.primary) {
      const description = buildServiceDescription(
        serviceName,
        business.name,
        locationContext,
        true
      );

      serviceItems.push({
        serviceName,
        description,
        locationContext,
        credentials: credentialsList.length > 0 ? credentialsList : undefined,
        isPrimary: true,
      });
    }
  }

  // Generate secondary service descriptions
  // PROMPT LOGIC: Secondary services get abbreviated treatment
  if (hasItems(services.secondary)) {
    for (const serviceName of services.secondary) {
      const description = buildServiceDescription(
        serviceName,
        business.name,
        locationContext,
        false
      );

      serviceItems.push({
        serviceName,
        description,
        locationContext,
        isPrimary: false,
      });
    }
  }

  const primaryCount = services.primary?.length ?? 0;
  const secondaryCount = services.secondary?.length ?? 0;

  return {
    services: serviceItems,
    summary: {
      totalServices: primaryCount + secondaryCount,
      primaryCount,
      secondaryCount,
    },
    sources: ['BusinessInput'],
  };
}

/**
 * Builds a service description string.
 * PROMPT LOGIC: Factual description without fabricated claims.
 */
function buildServiceDescription(
  serviceName: string,
  businessName: string | undefined,
  locationContext: string,
  isPrimary: boolean
): string {
  const entity = hasValue(businessName)
    ? businessName
    : missingDataPlaceholder('business.name');

  if (isPrimary) {
    return `${entity} offers ${serviceName} services in ${locationContext}. Contact for availability and service details.`;
  } else {
    return `${serviceName} also available from ${entity} in ${locationContext}.`;
  }
}
