/**
 * JSON Adapter
 *
 * Passthrough adapter that returns the GEO pipeline output unchanged.
 * This serves as the canonical format and source for all other adapters.
 *
 * DESIGN: Identity function - no transformation applied.
 */

import type { GEOPipelineOutput } from '../core/pipeline/geoPipeline';

/**
 * Returns the GEO pipeline output as-is (JSON passthrough).
 * This is the canonical format from which other adapters derive.
 *
 * @param output - The aggregated GEO pipeline output
 * @returns The same output unchanged
 */
export function toJSON(output: GEOPipelineOutput): GEOPipelineOutput {
  if (!output) {
    throw new Error('JSON Adapter: Output is required');
  }

  if (!output.metadata) {
    throw new Error('JSON Adapter: Missing required content block: metadata');
  }

  return output;
}

/**
 * Serializes the output to a formatted JSON string.
 *
 * @param output - The aggregated GEO pipeline output
 * @returns Formatted JSON string
 */
export function toJSONString(output: GEOPipelineOutput): string {
  const validated = toJSON(output);
  return JSON.stringify(validated, null, 2);
}
