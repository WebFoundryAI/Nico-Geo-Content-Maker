/**
 * GEO Pipeline Orchestrator
 *
 * Central orchestration module that coordinates all generators
 * to produce a complete GEO content package.
 *
 * DESIGN PRINCIPLES:
 * - Single input: BusinessInput
 * - Single output: Aggregated JSON
 * - Fixed execution order for determinism
 * - No side effects (no file writes)
 * - All generators must complete successfully
 */

import type { BusinessInput } from '../../inputs/business.schema';
import { enforceNoHallucinations } from '../rules/antiHallucination';

import { generateTitleMeta, TitleMetaOutput } from '../generators/titleMeta.generator';
import { generateAnswerCapsule, AnswerCapsuleOutput } from '../generators/answerCapsule.generator';
import { generateServiceDescription, ServiceDescriptionOutput } from '../generators/serviceDescription.generator';
import { generateFAQ, FAQOutput } from '../generators/faq.generator';
import { generateSchema, SchemaOutput } from '../generators/schema.generator';

/**
 * Complete GEO content output structure.
 * Aggregates all generator outputs into a single object.
 */
export interface GEOPipelineOutput {
  metadata: {
    generatedAt: string;
    businessName: string;
    pipelineVersion: string;
  };
  titleMeta: TitleMetaOutput;
  answerCapsule: AnswerCapsuleOutput;
  serviceDescriptions: ServiceDescriptionOutput;
  faq: FAQOutput;
  schema: SchemaOutput;
  allSources: string[];
}

/**
 * Pipeline configuration options.
 */
export interface PipelineOptions {
  /** Skip specific generators if needed */
  skip?: Array<'titleMeta' | 'answerCapsule' | 'serviceDescription' | 'faq' | 'schema'>;
}

/**
 * Executes the full GEO content generation pipeline.
 *
 * EXECUTION ORDER (fixed for determinism):
 * 1. Title & Meta
 * 2. Answer Capsule
 * 3. Service Descriptions
 * 4. FAQ
 * 5. Schema.org
 *
 * @param input - BusinessInput data (single source of truth)
 * @param options - Optional pipeline configuration
 * @returns Complete GEO content package as JSON
 */
export function runGEOPipeline(
  input: BusinessInput,
  options: PipelineOptions = {}
): GEOPipelineOutput {
  // Enforce anti-hallucination at pipeline level
  enforceNoHallucinations(input);

  const skip = options.skip ?? [];
  const allSources = new Set<string>();

  // Track sources helper
  const trackSources = (sources: string[]) => {
    sources.forEach(s => allSources.add(s));
  };

  // Execute generators in fixed order
  // PIPELINE STEP 1: Title & Meta
  const titleMeta = skip.includes('titleMeta')
    ? createSkippedOutput<TitleMetaOutput>('titleMeta')
    : generateTitleMeta(input);
  trackSources(titleMeta.sources);

  // PIPELINE STEP 2: Answer Capsule
  const answerCapsule = skip.includes('answerCapsule')
    ? createSkippedOutput<AnswerCapsuleOutput>('answerCapsule')
    : generateAnswerCapsule(input);
  trackSources(answerCapsule.sources);

  // PIPELINE STEP 3: Service Descriptions
  const serviceDescriptions = skip.includes('serviceDescription')
    ? createSkippedOutput<ServiceDescriptionOutput>('serviceDescription')
    : generateServiceDescription(input);
  trackSources(serviceDescriptions.sources);

  // PIPELINE STEP 4: FAQ
  const faq = skip.includes('faq')
    ? createSkippedOutput<FAQOutput>('faq')
    : generateFAQ(input);
  trackSources(faq.sources);

  // PIPELINE STEP 5: Schema.org
  const schema = skip.includes('schema')
    ? createSkippedOutput<SchemaOutput>('schema')
    : generateSchema(input);
  trackSources(schema.sources);

  // Aggregate final output
  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      businessName: input.business.name,
      pipelineVersion: '1.0.0',
    },
    titleMeta,
    answerCapsule,
    serviceDescriptions,
    faq,
    schema,
    allSources: Array.from(allSources),
  };
}

/**
 * Creates a placeholder output for skipped generators.
 */
function createSkippedOutput<T>(generatorName: string): T {
  return {
    skipped: true,
    reason: `Generator '${generatorName}' was skipped via pipeline options`,
    sources: ['SKIPPED'],
  } as unknown as T;
}

/**
 * Validates that all required fields are present in BusinessInput.
 * Returns list of validation errors (empty if valid).
 */
export function validatePipelineInput(input: BusinessInput): string[] {
  const errors: string[] = [];

  // Required fields
  if (!input.business?.name) {
    errors.push('business.name is required');
  }

  if (!input.location?.primaryCity) {
    errors.push('location.primaryCity is required');
  }

  if (!input.location?.country) {
    errors.push('location.country is required');
  }

  if (!input.services?.primary || input.services.primary.length === 0) {
    errors.push('services.primary must have at least one service');
  }

  if (!input.location?.serviceAreas || input.location.serviceAreas.length === 0) {
    errors.push('location.serviceAreas must have at least one area');
  }

  if (input.constraints?.noHallucinations !== true) {
    errors.push('constraints.noHallucinations must be true');
  }

  return errors;
}
