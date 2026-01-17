/**
 * Why Choose Us / Differentiators Generator
 *
 * Generates 4-6 compelling differentiators with specific proof points.
 * Directly answers "Why should I choose this business vs competitors?"
 * Builds E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness).
 *
 * PROMPT LOGIC:
 * - Extract proof points from existing BusinessInput data
 * - Generate differentiators based on actual credentials
 * - Connect each differentiator to local context
 * - Never fabricate or infer missing data
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
  hasPositiveNumber,
  extractProvidedFields,
} from '../rules/antiHallucination';

export interface WhyChooseUsDifferentiator {
  claim: string;
  proof: string;
  localContext: string;
  category: 'expertise' | 'experience' | 'local' | 'speed' | 'quality';
}

export interface WhyChooseUsOutput {
  summary: string;
  differentiators: WhyChooseUsDifferentiator[];
  callToAction: string;
  sources: string[];
}

/**
 * Generates "Why Choose Us" differentiators from BusinessInput.
 * Creates structured content highlighting unique value propositions.
 */
export function generateWhyChooseUs(input: BusinessInput): WhyChooseUsOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { business, location, services, credentials, proof, operations } = input;
  const differentiators: WhyChooseUsDifferentiator[] = [];

  // Build location context string
  const primaryLocation = hasValue(location.primaryCity)
    ? `${location.primaryCity}${hasValue(location.region) ? `, ${location.region}` : ''}`
    : '';

  // Extract provided credentials and proof
  const providedCredentials = extractProvidedFields(credentials);
  const providedProof = extractProvidedFields(proof);

  // ============================================================
  // DIFFERENTIATOR 1: Experience (Years Operating)
  // ============================================================
  if (providedCredentials && hasPositiveNumber(providedCredentials.yearsOperating)) {
    const years = providedCredentials.yearsOperating;
    differentiators.push({
      claim: `${years}+ years of professional experience`,
      proof: `Established track record with ${years} years serving customers`,
      localContext: primaryLocation
        ? `Trusted by ${primaryLocation} residents for over ${years} years`
        : `Over ${years} years of dedicated service`,
      category: 'experience',
    });
  }

  // ============================================================
  // DIFFERENTIATOR 2: Expertise (Licenses)
  // ============================================================
  if (providedCredentials && hasItems(providedCredentials.licenses)) {
    const licenses = providedCredentials.licenses;
    const licenseList = licenses.slice(0, 3).join(', ');
    differentiators.push({
      claim: `Fully licensed professionals`,
      proof: `Licensed: ${licenseList}${licenses.length > 3 ? ` and ${licenses.length - 3} more` : ''}`,
      localContext: primaryLocation
        ? `Meeting all ${primaryLocation} licensing requirements`
        : 'Meeting all local licensing requirements',
      category: 'expertise',
    });
  }

  // ============================================================
  // DIFFERENTIATOR 3: Expertise (Certifications)
  // ============================================================
  if (providedCredentials && hasItems(providedCredentials.certifications)) {
    const certs = providedCredentials.certifications;
    const certList = certs.slice(0, 3).join(', ');
    differentiators.push({
      claim: `Certified specialists`,
      proof: `Certifications: ${certList}${certs.length > 3 ? ` and ${certs.length - 3} more` : ''}`,
      localContext: primaryLocation
        ? `Bringing certified expertise to ${primaryLocation} customers`
        : 'Certified expertise you can trust',
      category: 'expertise',
    });
  }

  // ============================================================
  // DIFFERENTIATOR 4: Quality (Insurance)
  // ============================================================
  if (providedCredentials && hasValue(providedCredentials.insurance)) {
    differentiators.push({
      claim: `Fully insured for your protection`,
      proof: `Insurance coverage: ${providedCredentials.insurance}`,
      localContext: primaryLocation
        ? `Protecting ${primaryLocation} customers with comprehensive coverage`
        : 'Comprehensive insurance protection for peace of mind',
      category: 'quality',
    });
  }

  // ============================================================
  // DIFFERENTIATOR 5: Quality (Reviews)
  // ============================================================
  if (
    providedProof &&
    hasPositiveNumber(providedProof.reviewCount) &&
    hasPositiveNumber(providedProof.averageRating)
  ) {
    const reviewCount = providedProof.reviewCount;
    const rating = providedProof.averageRating;
    differentiators.push({
      claim: `Highly rated by customers`,
      proof: `${reviewCount} reviews with ${rating.toFixed(1)} average rating`,
      localContext: primaryLocation
        ? `Trusted by ${reviewCount} ${primaryLocation} area customers`
        : `${reviewCount} satisfied customers and counting`,
      category: 'quality',
    });
  }

  // ============================================================
  // DIFFERENTIATOR 6: Local (Service Areas)
  // ============================================================
  if (hasItems(location.serviceAreas) && location.serviceAreas.length > 1) {
    const areaCount = location.serviceAreas.length;
    const areaList = location.serviceAreas.slice(0, 3).join(', ');
    differentiators.push({
      claim: `Serving ${areaCount} local areas`,
      proof: `Service areas include: ${areaList}${areaCount > 3 ? ` and ${areaCount - 3} more` : ''}`,
      localContext: primaryLocation
        ? `Comprehensive coverage throughout ${primaryLocation} and surrounding areas`
        : `Covering ${areaCount} service areas for your convenience`,
      category: 'local',
    });
  }

  // ============================================================
  // DIFFERENTIATOR 7: Speed (Emergency Service)
  // ============================================================
  if (operations?.emergencyService === true) {
    differentiators.push({
      claim: `Emergency service available`,
      proof: `24/7 emergency response capability`,
      localContext: primaryLocation
        ? `Fast emergency response for ${primaryLocation} residents`
        : 'Available when you need us most',
      category: 'speed',
    });
  }

  // ============================================================
  // DIFFERENTIATOR 8: Expertise (Primary Services)
  // ============================================================
  if (hasItems(services.primary) && services.primary.length >= 2) {
    const serviceCount = services.primary.length;
    const serviceList = services.primary.slice(0, 3).join(', ');
    differentiators.push({
      claim: `Comprehensive ${services.primary[0]} expertise`,
      proof: `Specializing in ${serviceList}${serviceCount > 3 ? ` and ${serviceCount - 3} more services` : ''}`,
      localContext: primaryLocation
        ? `Full-service solutions for ${primaryLocation} homes and businesses`
        : 'Full-service solutions for all your needs',
      category: 'expertise',
    });
  }

  // Build summary based on available differentiators
  const summary = buildSummary(business.name, primaryLocation, differentiators);

  // Build call to action
  const callToAction = buildCallToAction(business.name, primaryLocation);

  return {
    summary,
    differentiators,
    callToAction,
    sources: ['BusinessInput'],
  };
}

/**
 * Builds a summary paragraph based on available differentiators.
 */
function buildSummary(
  businessName: string,
  location: string,
  differentiators: WhyChooseUsDifferentiator[]
): string {
  if (differentiators.length === 0) {
    return `${businessName} provides professional services${location ? ` in ${location}` : ''}.`;
  }

  // Highlight key differentiator categories present
  const categories = new Set(differentiators.map(d => d.category));
  const highlights: string[] = [];

  if (categories.has('experience')) {
    highlights.push('proven track record');
  }
  if (categories.has('expertise')) {
    highlights.push('certified expertise');
  }
  if (categories.has('quality')) {
    highlights.push('commitment to quality');
  }
  if (categories.has('local')) {
    highlights.push('local coverage');
  }
  if (categories.has('speed')) {
    highlights.push('responsive service');
  }

  const highlightText = highlights.length > 0
    ? highlights.join(', ')
    : 'professional service';

  return `${businessName} stands out through ${highlightText}${location ? ` in ${location}` : ''}. With ${differentiators.length} key differentiators, customers can trust in verified credentials and real results.`;
}

/**
 * Builds a call to action string.
 */
function buildCallToAction(businessName: string, location: string): string {
  return location
    ? `Contact ${businessName} today to experience the difference in ${location}.`
    : `Contact ${businessName} today to experience the difference.`;
}
