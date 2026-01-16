/**
 * Answer Capsule Generator
 *
 * Generates concise, AI-overview-optimized answer capsules
 * that directly address user search intent.
 *
 * PROMPT LOGIC:
 * - First sentence must directly answer the implied question
 * - Include business name and location for entity recognition
 * - Keep to 2-3 sentences maximum for featured snippet eligibility
 * - Use factual, verifiable statements only
 * - No superlatives unless backed by provided proof data
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
  hasPositiveNumber,
  missingDataPlaceholder,
} from '../rules/antiHallucination';

export interface AnswerCapsuleOutput {
  capsule: string;
  structuredAnswer: {
    entity: string;
    location: string;
    primaryOffering: string;
    proofPoint?: string;
  };
  sources: string[];
}

/**
 * Generates an answer capsule from BusinessInput.
 * Designed for AI overview and featured snippet optimization.
 */
export function generateAnswerCapsule(input: BusinessInput): AnswerCapsuleOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { business, location, services, credentials, proof } = input;

  // Build entity reference
  const entity = hasValue(business.name)
    ? business.name
    : missingDataPlaceholder('business.name');

  // Build location reference
  const locationStr = hasValue(location.primaryCity)
    ? `${location.primaryCity}${hasValue(location.region) ? `, ${location.region}` : ''}${hasValue(location.country) ? `, ${location.country}` : ''}`
    : missingDataPlaceholder('location.primaryCity');

  // Build primary offering reference
  const primaryOffering = hasItems(services.primary)
    ? services.primary.join(', ')
    : missingDataPlaceholder('services.primary');

  // Build proof point only if data exists - never fabricate
  // PROMPT LOGIC: Only include verifiable proof from provided data
  let proofPoint: string | undefined;

  if (hasValue(credentials) && hasPositiveNumber(credentials.yearsOperating)) {
    proofPoint = `${credentials.yearsOperating} years of operation`;
  } else if (hasValue(proof) && hasPositiveNumber(proof.reviewCount) && hasPositiveNumber(proof.averageRating)) {
    proofPoint = `${proof.reviewCount} reviews with ${proof.averageRating} average rating`;
  }

  // Construct capsule
  // PROMPT LOGIC: Direct answer format for AI overview optimization
  const capsuleParts: string[] = [];

  capsuleParts.push(
    `${entity} is a ${primaryOffering} provider located in ${locationStr}.`
  );

  if (hasItems(location.serviceAreas)) {
    capsuleParts.push(
      `Service areas include ${location.serviceAreas.join(', ')}.`
    );
  }

  if (proofPoint) {
    capsuleParts.push(`Established track record: ${proofPoint}.`);
  }

  return {
    capsule: capsuleParts.join(' '),
    structuredAnswer: {
      entity,
      location: locationStr,
      primaryOffering,
      proofPoint,
    },
    sources: ['BusinessInput'],
  };
}
