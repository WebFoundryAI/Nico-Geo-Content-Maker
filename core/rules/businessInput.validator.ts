/**
 * BusinessInput Runtime Validator
 *
 * Strict runtime validation for BusinessInput objects.
 * Ensures data integrity before pipeline execution.
 *
 * DESIGN PRINCIPLES:
 * - Fail loudly with clear error messages
 * - No defaults or inferred values
 * - Reject unknown top-level keys
 * - Type-check all fields at runtime
 */

import type { BusinessInput } from '../../inputs/business.schema';

/**
 * Validation result containing success status and any errors.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Allowed top-level keys in BusinessInput.
 * Any key not in this list will cause validation to fail.
 */
const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'business',
  'location',
  'contact',
  'services',
  'credentials',
  'proof',
  'operations',
  'constraints',
]);

/**
 * Validates a parsed object against the BusinessInput schema at runtime.
 *
 * This validator:
 * - Checks all required fields exist and have correct types
 * - Rejects unknown top-level keys
 * - Does NOT apply defaults or infer missing data
 * - Returns detailed error messages for each violation
 *
 * @param input - Unknown object to validate
 * @returns ValidationResult with valid flag and error list
 */
export function validateBusinessInput(input: unknown): ValidationResult {
  const errors: string[] = [];

  // Check input is an object
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push('Input must be a non-null object');
    return { valid: false, errors };
  }

  const obj = input as Record<string, unknown>;

  // Check for unknown top-level keys
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      errors.push(`Unknown top-level key: '${key}'. Allowed keys: ${Array.from(ALLOWED_TOP_LEVEL_KEYS).join(', ')}`);
    }
  }

  // Validate business (required)
  validateBusinessSection(obj.business, errors);

  // Validate location (required)
  validateLocationSection(obj.location, errors);

  // Validate contact (optional but must be valid if present)
  if (obj.contact !== undefined) {
    validateContactSection(obj.contact, errors);
  }

  // Validate services (required)
  validateServicesSection(obj.services, errors);

  // Validate credentials (optional but must be valid if present)
  if (obj.credentials !== undefined) {
    validateCredentialsSection(obj.credentials, errors);
  }

  // Validate proof (optional but must be valid if present)
  if (obj.proof !== undefined) {
    validateProofSection(obj.proof, errors);
  }

  // Validate operations (optional but must be valid if present)
  if (obj.operations !== undefined) {
    validateOperationsSection(obj.operations, errors);
  }

  // Validate constraints (required)
  validateConstraintsSection(obj.constraints, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates the business section.
 */
function validateBusinessSection(business: unknown, errors: string[]): void {
  if (!business || typeof business !== 'object') {
    errors.push('Required section missing: business');
    return;
  }

  const b = business as Record<string, unknown>;

  // name is required
  if (typeof b.name !== 'string' || b.name.trim() === '') {
    errors.push('business.name is required and must be a non-empty string');
  }

  // Optional fields type checks
  if (b.legalName !== undefined && typeof b.legalName !== 'string') {
    errors.push('business.legalName must be a string if provided');
  }
  if (b.website !== undefined && typeof b.website !== 'string') {
    errors.push('business.website must be a string if provided');
  }
  if (b.domain !== undefined && typeof b.domain !== 'string') {
    errors.push('business.domain must be a string if provided');
  }
}

/**
 * Validates the location section.
 */
function validateLocationSection(location: unknown, errors: string[]): void {
  if (!location || typeof location !== 'object') {
    errors.push('Required section missing: location');
    return;
  }

  const loc = location as Record<string, unknown>;

  // primaryCity is required
  if (typeof loc.primaryCity !== 'string' || loc.primaryCity.trim() === '') {
    errors.push('location.primaryCity is required and must be a non-empty string');
  }

  // country is required
  if (typeof loc.country !== 'string' || loc.country.trim() === '') {
    errors.push('location.country is required and must be a non-empty string');
  }

  // serviceAreas is required and must be non-empty array
  if (!Array.isArray(loc.serviceAreas)) {
    errors.push('location.serviceAreas is required and must be an array');
  } else if (loc.serviceAreas.length === 0) {
    errors.push('location.serviceAreas must contain at least one area');
  } else {
    for (let i = 0; i < loc.serviceAreas.length; i++) {
      if (typeof loc.serviceAreas[i] !== 'string') {
        errors.push(`location.serviceAreas[${i}] must be a string`);
      }
    }
  }

  // Optional field type check
  if (loc.region !== undefined && typeof loc.region !== 'string') {
    errors.push('location.region must be a string if provided');
  }
}

/**
 * Validates the contact section.
 */
function validateContactSection(contact: unknown, errors: string[]): void {
  if (typeof contact !== 'object' || contact === null) {
    errors.push('contact must be an object if provided');
    return;
  }

  const c = contact as Record<string, unknown>;

  if (c.phone !== undefined && typeof c.phone !== 'string') {
    errors.push('contact.phone must be a string if provided');
  }
  if (c.email !== undefined && typeof c.email !== 'string') {
    errors.push('contact.email must be a string if provided');
  }
}

/**
 * Validates the services section.
 */
function validateServicesSection(services: unknown, errors: string[]): void {
  if (!services || typeof services !== 'object') {
    errors.push('Required section missing: services');
    return;
  }

  const s = services as Record<string, unknown>;

  // primary is required and must be non-empty array
  if (!Array.isArray(s.primary)) {
    errors.push('services.primary is required and must be an array');
  } else if (s.primary.length === 0) {
    errors.push('services.primary must contain at least one service');
  } else {
    for (let i = 0; i < s.primary.length; i++) {
      if (typeof s.primary[i] !== 'string') {
        errors.push(`services.primary[${i}] must be a string`);
      }
    }
  }

  // Optional secondary array
  if (s.secondary !== undefined) {
    if (!Array.isArray(s.secondary)) {
      errors.push('services.secondary must be an array if provided');
    } else {
      for (let i = 0; i < s.secondary.length; i++) {
        if (typeof s.secondary[i] !== 'string') {
          errors.push(`services.secondary[${i}] must be a string`);
        }
      }
    }
  }
}

/**
 * Validates the credentials section.
 */
function validateCredentialsSection(credentials: unknown, errors: string[]): void {
  if (typeof credentials !== 'object' || credentials === null) {
    errors.push('credentials must be an object if provided');
    return;
  }

  const c = credentials as Record<string, unknown>;

  if (c.yearsOperating !== undefined && typeof c.yearsOperating !== 'number') {
    errors.push('credentials.yearsOperating must be a number if provided');
  }

  if (c.licenses !== undefined) {
    if (!Array.isArray(c.licenses)) {
      errors.push('credentials.licenses must be an array if provided');
    } else {
      for (let i = 0; i < c.licenses.length; i++) {
        if (typeof c.licenses[i] !== 'string') {
          errors.push(`credentials.licenses[${i}] must be a string`);
        }
      }
    }
  }

  if (c.insurance !== undefined && typeof c.insurance !== 'string') {
    errors.push('credentials.insurance must be a string if provided');
  }

  if (c.certifications !== undefined) {
    if (!Array.isArray(c.certifications)) {
      errors.push('credentials.certifications must be an array if provided');
    } else {
      for (let i = 0; i < c.certifications.length; i++) {
        if (typeof c.certifications[i] !== 'string') {
          errors.push(`credentials.certifications[${i}] must be a string`);
        }
      }
    }
  }
}

/**
 * Validates the proof section.
 */
function validateProofSection(proof: unknown, errors: string[]): void {
  if (typeof proof !== 'object' || proof === null) {
    errors.push('proof must be an object if provided');
    return;
  }

  const p = proof as Record<string, unknown>;

  if (p.reviewCount !== undefined && typeof p.reviewCount !== 'number') {
    errors.push('proof.reviewCount must be a number if provided');
  }
  if (p.averageRating !== undefined && typeof p.averageRating !== 'number') {
    errors.push('proof.averageRating must be a number if provided');
  }
  if (p.testimonialsAvailable !== undefined && typeof p.testimonialsAvailable !== 'boolean') {
    errors.push('proof.testimonialsAvailable must be a boolean if provided');
  }
  if (p.caseStudiesAvailable !== undefined && typeof p.caseStudiesAvailable !== 'boolean') {
    errors.push('proof.caseStudiesAvailable must be a boolean if provided');
  }
}

/**
 * Validates the operations section.
 */
function validateOperationsSection(operations: unknown, errors: string[]): void {
  if (typeof operations !== 'object' || operations === null) {
    errors.push('operations must be an object if provided');
    return;
  }

  const o = operations as Record<string, unknown>;

  if (o.operatingHours !== undefined && typeof o.operatingHours !== 'string') {
    errors.push('operations.operatingHours must be a string if provided');
  }
  if (o.emergencyService !== undefined && typeof o.emergencyService !== 'boolean') {
    errors.push('operations.emergencyService must be a boolean if provided');
  }
}

/**
 * Validates the constraints section.
 */
function validateConstraintsSection(constraints: unknown, errors: string[]): void {
  if (!constraints || typeof constraints !== 'object') {
    errors.push('Required section missing: constraints');
    return;
  }

  const c = constraints as Record<string, unknown>;

  // noHallucinations must be exactly true
  if (c.noHallucinations !== true) {
    errors.push('constraints.noHallucinations is required and must be exactly true');
  }

  // Optional allowedSources array
  if (c.allowedSources !== undefined) {
    if (!Array.isArray(c.allowedSources)) {
      errors.push('constraints.allowedSources must be an array if provided');
    } else {
      for (let i = 0; i < c.allowedSources.length; i++) {
        if (typeof c.allowedSources[i] !== 'string') {
          errors.push(`constraints.allowedSources[${i}] must be a string`);
        }
      }
    }
  }
}

/**
 * Asserts that the input is valid, throwing an error if not.
 * Use this for fail-fast validation in scripts.
 */
export function assertValidBusinessInput(input: unknown): asserts input is BusinessInput {
  const result = validateBusinessInput(input);
  if (!result.valid) {
    throw new Error(
      `BusinessInput validation failed:\n${result.errors.map(e => `  - ${e}`).join('\n')}`
    );
  }
}
