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
 * - Validates input using strict runtime validator
 * - Executes the GEO pipeline
 * - Validates output against contract
 * - Runs all output adapters (JSON, Markdown, HTML)
 * - Writes three output files to /outputs
 */

import * as fs from 'fs';
import * as path from 'path';

import type { BusinessInput } from '../inputs/business.schema';
import { runGEOPipeline } from '../core/pipeline/geoPipeline';
import { validateBusinessInput } from '../core/rules/businessInput.validator';
import { validateGEOOutput } from '../contracts/output.contract';

// Import adapters
import { toJSONString } from '../adapters/json.adapter';
import { toMarkdown } from '../adapters/markdown.adapter';
import { toHTML } from '../adapters/html.adapter';

// File paths
const INPUT_FILE = path.resolve(__dirname, '../inputs/example.business.json');
const OUTPUT_DIR = path.resolve(__dirname, '../outputs');
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'example-output.json');
const OUTPUT_MD = path.join(OUTPUT_DIR, 'example-output.md');
const OUTPUT_HTML = path.join(OUTPUT_DIR, 'example-output.html');

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

  // Step 2: Validate input using strict runtime validator
  console.log('Validating input structure...');

  const validationResult = validateBusinessInput(rawInput);
  if (!validationResult.valid) {
    console.error('ERROR: Input validation failed:');
    validationResult.errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  const input = rawInput as BusinessInput;
  console.log('Input validation passed.\n');

  // Step 3: Execute pipeline
  console.log('Executing GEO pipeline...');

  let output;
  try {
    output = runGEOPipeline(input);
  } catch (err) {
    console.error(`ERROR: Pipeline execution failed: ${err}`);
    process.exit(1);
  }

  console.log('Pipeline execution complete.\n');

  // Step 4: Validate output against contract
  console.log('Validating output against contract...');

  const outputErrors = validateGEOOutput(output);
  if (outputErrors.length > 0) {
    console.error('ERROR: Output validation failed:');
    outputErrors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  console.log('Output validation passed.\n');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Step 5: Run adapters and write outputs
  console.log('Running output adapters...\n');

  // JSON output (canonical)
  console.log(`  Writing JSON: ${OUTPUT_JSON}`);
  try {
    const jsonOutput = toJSONString(output);
    fs.writeFileSync(OUTPUT_JSON, jsonOutput, 'utf-8');
  } catch (err) {
    console.error(`ERROR: JSON adapter failed: ${err}`);
    process.exit(1);
  }

  // Markdown output
  console.log(`  Writing Markdown: ${OUTPUT_MD}`);
  try {
    const mdOutput = toMarkdown(output);
    fs.writeFileSync(OUTPUT_MD, mdOutput, 'utf-8');
  } catch (err) {
    console.error(`ERROR: Markdown adapter failed: ${err}`);
    process.exit(1);
  }

  // HTML output
  console.log(`  Writing HTML: ${OUTPUT_HTML}`);
  try {
    const htmlOutput = toHTML(output);
    fs.writeFileSync(OUTPUT_HTML, htmlOutput, 'utf-8');
  } catch (err) {
    console.error(`ERROR: HTML adapter failed: ${err}`);
    process.exit(1);
  }

  console.log('\nGEO Pipeline completed successfully.');
  console.log('Outputs written:');
  console.log(`  - ${OUTPUT_JSON}`);
  console.log(`  - ${OUTPUT_MD}`);
  console.log(`  - ${OUTPUT_HTML}`);
}

// Execute
main();
