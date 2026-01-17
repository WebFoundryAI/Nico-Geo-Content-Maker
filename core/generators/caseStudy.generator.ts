/**
 * Case Study Generator
 *
 * Generates narrative case studies showing real project outcomes.
 * Builds credibility and shows tangible results.
 *
 * PROMPT LOGIC:
 * - Use provided case study data if available
 * - Return empty if no case studies provided (strict anti-hallucination)
 * - Enhance narratives with location context
 * - Ensure results are quantified with provided data
 * - Never fabricate case studies or metrics
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
} from '../rules/antiHallucination';

export interface CaseStudyResult {
  metric: string;
  value: string;
}

export interface CaseStudy {
  title: string;
  challenge: string;
  solution: string;
  results: CaseStudyResult[];
  projectType: string;
  location: string;
  clientAttribution?: string;
  sources: string[];
}

export interface CaseStudyOutput {
  caseStudies: CaseStudy[];
  summary: string;
  sources: string[];
}

/**
 * Generates case studies from BusinessInput.
 * Returns empty array if no case study data is provided (no hallucination).
 */
export function generateCaseStudy(input: BusinessInput): CaseStudyOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { business, location, caseStudies } = input;

  // If no case studies provided, return empty output
  // We DO NOT generate template case studies to avoid hallucination
  if (!caseStudies || !hasItems(caseStudies.studies)) {
    return {
      caseStudies: [],
      summary: '',
      sources: ['BusinessInput'],
    };
  }

  // Build location context
  const primaryLocation = hasValue(location.primaryCity)
    ? `${location.primaryCity}${hasValue(location.region) ? `, ${location.region}` : ''}`
    : '';

  const processedCaseStudies: CaseStudy[] = [];

  for (const study of caseStudies.studies) {
    // Validate required fields
    if (
      !hasValue(study.title) ||
      !hasValue(study.challenge) ||
      !hasValue(study.solution) ||
      !hasItems(study.results)
    ) {
      continue; // Skip incomplete case studies
    }

    const processedStudy = buildCaseStudy(study, business.name, primaryLocation);
    processedCaseStudies.push(processedStudy);
  }

  // Build summary
  const summary = buildSummary(processedCaseStudies, business.name, primaryLocation);

  return {
    caseStudies: processedCaseStudies,
    summary,
    sources: ['BusinessInput'],
  };
}

/**
 * Builds a structured case study from provided data.
 */
function buildCaseStudy(
  study: NonNullable<BusinessInput['caseStudies']>['studies'][0],
  businessName: string,
  primaryLocation: string
): CaseStudy {
  // Enhance challenge narrative
  const challenge = enhanceChallenge(study.challenge, study.projectType, study.location);

  // Enhance solution narrative
  const solution = enhanceSolution(study.solution, businessName, study.projectType);

  // Process results
  const results: CaseStudyResult[] = study.results.map(r => ({
    metric: r.metric,
    value: r.value,
  }));

  // Determine client attribution
  const clientAttribution = hasValue(study.clientName)
    ? study.clientName
    : `Anonymous ${study.projectType.toLowerCase()} client`;

  // Determine location for case study
  const caseLocation = hasValue(study.location)
    ? study.location
    : primaryLocation || 'Local area';

  return {
    title: study.title,
    challenge,
    solution,
    results,
    projectType: study.projectType,
    location: caseLocation,
    clientAttribution,
    sources: ['BusinessInput'],
  };
}

/**
 * Enhances the challenge description with context.
 */
function enhanceChallenge(
  challenge: string,
  projectType: string,
  location: string
): string {
  // If challenge is already detailed (50+ chars), return as-is
  if (challenge.length >= 50) {
    return challenge;
  }

  // Add context to brief challenges
  const parts: string[] = [];

  if (location) {
    parts.push(`A ${projectType.toLowerCase()} client in ${location} faced a challenge:`);
  } else {
    parts.push(`A ${projectType.toLowerCase()} client faced a challenge:`);
  }

  parts.push(challenge);

  return parts.join(' ');
}

/**
 * Enhances the solution description with context.
 */
function enhanceSolution(
  solution: string,
  businessName: string,
  projectType: string
): string {
  // If solution is already detailed (75+ chars), return as-is
  if (solution.length >= 75) {
    return solution;
  }

  // Add context to brief solutions
  const parts: string[] = [];

  parts.push(`${businessName} addressed this ${projectType.toLowerCase()} project by:`);
  parts.push(solution);

  return parts.join(' ');
}

/**
 * Builds a summary of all case studies.
 */
function buildSummary(
  caseStudies: CaseStudy[],
  businessName: string,
  primaryLocation: string
): string {
  if (caseStudies.length === 0) {
    return '';
  }

  const projectTypes = [...new Set(caseStudies.map(cs => cs.projectType))];
  const totalResults = caseStudies.reduce(
    (sum, cs) => sum + cs.results.length,
    0
  );

  const parts: string[] = [];

  parts.push(`${caseStudies.length} case stud${caseStudies.length === 1 ? 'y' : 'ies'} demonstrating ${businessName}'s results`);

  if (primaryLocation) {
    parts.push(`in ${primaryLocation}`);
  }

  if (projectTypes.length > 0) {
    const typeList = projectTypes.slice(0, 3).join(', ').toLowerCase();
    parts.push(`across ${typeList} projects`);
  }

  if (totalResults > 0) {
    parts.push(`with ${totalResults} quantified outcome${totalResults > 1 ? 's' : ''}`);
  }

  return parts.join(' ') + '.';
}
