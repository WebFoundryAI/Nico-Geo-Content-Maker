/**
 * Anti-Hallucination Enforcement Rules
 *
 * This module ensures that all generators only reference data
 * explicitly provided in BusinessInput. No inferred, fabricated,
 * or assumed data is permitted.
 */

import type { BusinessInput } from '../../inputs/business.schema';

/**
 * List of fields that MUST NOT be inferred or fabricated.
 * If these fields are not present in BusinessInput, they must be omitted entirely.
 */
export const FORBIDDEN_INFERENCES = [
  'yearsOperating',
  'licenses',
  'certifications',
  'insurance',
  'reviewCount',
  'averageRating',
  'serviceAreas not explicitly listed',
  'locations not explicitly listed',
  'services not explicitly listed',
  'awards or recognitions',
  'staff names or counts',
  'pricing information',
  'specific project history',
] as const;

/**
 * Validates that a value exists and is not undefined/null.
 * Use this to check optional fields before including them in output.
 */
export function hasValue<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

/**
 * Validates that an array exists and has at least one element.
 */
export function hasItems<T>(arr: T[] | undefined | null): arr is T[] {
  return Array.isArray(arr) && arr.length > 0;
}

/**
 * Validates that a numeric value exists and is greater than zero.
 */
export function hasPositiveNumber(value: number | undefined | null): value is number {
  return typeof value === 'number' && value > 0;
}

/**
 * Extracts only the fields that are explicitly provided in BusinessInput.
 * Returns undefined for any field that is not present.
 */
export function extractProvidedFields<T extends object>(
  obj: T | undefined
): Partial<T> | undefined {
  if (!obj) return undefined;

  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const value = obj[key];
    if (hasValue(value)) {
      if (Array.isArray(value) && value.length === 0) {
        continue; // Skip empty arrays
      }
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Asserts that the constraints.noHallucinations flag is true.
 * All generators must call this before processing.
 */
export function enforceNoHallucinations(input: BusinessInput): void {
  if (input.constraints.noHallucinations !== true) {
    throw new Error(
      'Anti-hallucination enforcement failed: constraints.noHallucinations must be true'
    );
  }
}

/**
 * Creates a safe string that indicates missing data rather than fabricating it.
 * Use this for required output fields when source data is unavailable.
 */
export function missingDataPlaceholder(fieldName: string): string {
  return `[DATA_REQUIRED: ${fieldName}]`;
}

/**
 * Validates that a generator output only contains data from allowed sources.
 */
export function validateAllowedSources(
  input: BusinessInput,
  sourcesUsed: string[]
): boolean {
  const allowed = input.constraints.allowedSources;
  if (!allowed || allowed.length === 0) {
    // If no allowed sources specified, only BusinessInput itself is permitted
    return sourcesUsed.every(s => s === 'BusinessInput');
  }
  return sourcesUsed.every(s => allowed.includes(s) || s === 'BusinessInput');
}
