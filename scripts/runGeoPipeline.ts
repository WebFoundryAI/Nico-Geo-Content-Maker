/**
 * GEO Pipeline Execution Script
 *
 * A minimal, safe execution interface for running the GEO pipeline
 * with structured BusinessInput data.
 *
 * Usage: npx ts-node scripts/runGeoPipeline.ts
 *
 * This script:
 * - Loads BusinessInput from /inputs/example.business.json
 * - Validates required fields
 * - Executes the GEO pipeline
 * - Writes output to /outputs/example-output.json
 */

import * as fs from 'fs';
import * as path from 'path';

import type { BusinessInput } from '../inputs/business.schema';
import { runGEOPipeline, validatePipelineInput } from '../core/pipeline/geoPipeline';

// File paths
const INPUT_FILE = path.resolve(__dirname, '../inputs/example.business.json');
const OUTPUT_FILE = path.resolve(__dirname, '../outputs/example-output.json');

/**
 * Main execution function
 */
function main(): void {
  console.log('GEO Pipeline Execution');
  console.log('======================\n');

  // Step 1: Load input file
  console.log(`Loading input from: ${INPUT_FILE}`);

  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`ERROR: Input file not found: ${INPUT_FILE}`);
    process.exit(1);
  }

  let rawInput: unknown;
  try {
    const fileContent = fs.readFileSync(INPUT_FILE, 'utf-8');
    rawInput = JSON.parse(fileContent);
  } catch (err) {
    console.error(`ERROR: Failed to parse input file: ${err}`);
    process.exit(1);
  }

  // Step 2: Validate required structure
  console.log('Validating input structure...');

  const validationErrors = validateRequiredFields(rawInput);
  if (validationErrors.length > 0) {
    console.error('ERROR: Input validation failed:');
    validationErrors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  const input = rawInput as BusinessInput;

  // Step 3: Run pipeline validation
  const pipelineErrors = validatePipelineInput(input);
  if (pipelineErrors.length > 0) {
    console.error('ERROR: Pipeline validation failed:');
    pipelineErrors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  console.log('Input validation passed.\n');

  // Step 4: Execute pipeline
  console.log('Executing GEO pipeline...');

  let output;
  try {
    output = runGEOPipeline(input);
  } catch (err) {
    console.error(`ERROR: Pipeline execution failed: ${err}`);
    process.exit(1);
  }

  console.log('Pipeline execution complete.\n');

  // Step 5: Write output
  console.log(`Writing output to: ${OUTPUT_FILE}`);

  try {
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
  } catch (err) {
    console.error(`ERROR: Failed to write output file: ${err}`);
    process.exit(1);
  }

  console.log('\nGEO Pipeline completed successfully.');
  console.log(`Output written to: ${OUTPUT_FILE}`);
}

/**
 * Validates that required fields exist in the input object.
 * Returns array of error messages (empty if valid).
 */
function validateRequiredFields(input: unknown): string[] {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    errors.push('Input must be a valid object');
    return errors;
  }

  const obj = input as Record<string, unknown>;

  // Check business.name
  if (!obj.business || typeof obj.business !== 'object') {
    errors.push('Missing required field: business');
  } else {
    const business = obj.business as Record<string, unknown>;
    if (!business.name || typeof business.name !== 'string') {
      errors.push('Missing required field: business.name');
    }
  }

  // Check location
  if (!obj.location || typeof obj.location !== 'object') {
    errors.push('Missing required field: location');
  } else {
    const location = obj.location as Record<string, unknown>;
    if (!location.primaryCity || typeof location.primaryCity !== 'string') {
      errors.push('Missing required field: location.primaryCity');
    }
    if (!location.country || typeof location.country !== 'string') {
      errors.push('Missing required field: location.country');
    }
    if (!Array.isArray(location.serviceAreas) || location.serviceAreas.length === 0) {
      errors.push('Missing required field: location.serviceAreas (must be non-empty array)');
    }
  }

  // Check services
  if (!obj.services || typeof obj.services !== 'object') {
    errors.push('Missing required field: services');
  } else {
    const services = obj.services as Record<string, unknown>;
    if (!Array.isArray(services.primary) || services.primary.length === 0) {
      errors.push('Missing required field: services.primary (must be non-empty array)');
    }
  }

  // Check constraints
  if (!obj.constraints || typeof obj.constraints !== 'object') {
    errors.push('Missing required field: constraints');
  } else {
    const constraints = obj.constraints as Record<string, unknown>;
    if (constraints.noHallucinations !== true) {
      errors.push('Required field constraints.noHallucinations must be true');
    }
  }

  return errors;
}

// Execute
main();
