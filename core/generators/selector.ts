/**
 * Generator Selector
 *
 * Determines which generators to run based on:
 * 1. Explicit user preferences (enabled/disabled arrays)
 * 2. Auto-detection based on business type/industry
 * 3. Default behavior (core generators only)
 *
 * SELECTION PRIORITY:
 * 1. If enabled array is provided, use only those generators
 * 2. If autoDetect is true (default), detect industry and include applicable generators
 * 3. If autoDetect is false and no enabled array, use core generators only
 * 4. Always respect disabled array (removes from final selection)
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  GENERATOR_REGISTRY,
  calculateEstimatedTime,
  isValidGenerator,
} from './registry';

/**
 * User preferences for generator selection.
 */
export interface GeneratorPreference {
  /** Explicitly enable specific generators (overrides autoDetect) */
  enabled?: string[];
  /** Explicitly disable specific generators (always respected) */
  disabled?: string[];
  /** Auto-detect industry and include applicable generators (default: true) */
  autoDetect?: boolean;
}

/**
 * Result of generator selection.
 */
export interface GeneratorSelection {
  /** Generators that will be executed */
  enabled: string[];
  /** Generators that were explicitly disabled */
  disabled: string[];
  /** Whether auto-detection was used */
  autoDetect: boolean;
  /** Estimated total execution time in milliseconds */
  estimatedTotalTime: number;
  /** Detected industry type (if auto-detected) */
  detectedIndustry?: string;
}

/**
 * Industry type mappings based on service keywords.
 */
const INDUSTRY_KEYWORDS: Record<string, string> = {
  // Plumbing
  plumb: 'plumbing',
  drain: 'plumbing',
  'water heater': 'plumbing',
  sewer: 'plumbing',
  pipe: 'plumbing',

  // HVAC
  hvac: 'hvac',
  heating: 'hvac',
  cooling: 'hvac',
  'air conditioning': 'hvac',
  furnace: 'hvac',
  'heat pump': 'hvac',

  // Electrical
  electric: 'electrical',
  wiring: 'electrical',
  panel: 'electrical',
  outlet: 'electrical',
  breaker: 'electrical',

  // Roofing
  roof: 'roofing',
  shingle: 'roofing',
  gutter: 'roofing',
  siding: 'roofing',

  // General Contractor
  contractor: 'contractor',
  remodel: 'contractor',
  renovation: 'contractor',
  construction: 'contractor',
  addition: 'contractor',

  // Real Estate
  'real estate': 'realEstate',
  realtor: 'realEstate',
  'real-estate': 'realEstate',
  property: 'realEstate',
  'home sale': 'realEstate',
  buyer: 'realEstate',
  seller: 'realEstate',

  // Mortgage
  mortgage: 'mortgage',
  loan: 'mortgage',
  lending: 'mortgage',
  'home loan': 'mortgage',
  refinance: 'mortgage',

  // Legal
  lawyer: 'lawyer',
  attorney: 'lawyer',
  'law firm': 'lawyer',
  legal: 'lawyer',
  'personal injury': 'lawyer',
  'family law': 'lawyer',
  divorce: 'lawyer',
  criminal: 'lawyer',

  // Landscaping
  landscape: 'landscaping',
  lawn: 'landscaping',
  garden: 'landscaping',
  tree: 'landscaping',
  irrigation: 'landscaping',

  // Pools
  pool: 'pools',
  spa: 'pools',
  'hot tub': 'pools',
  swimming: 'pools',
};

/**
 * Selects which generators to run based on business input and user preferences.
 *
 * @param businessInput - The business input data
 * @param userPreference - Optional user preferences for generator selection
 * @returns Selection result with enabled generators and timing estimate
 */
export async function selectGenerators(
  businessInput: BusinessInput,
  userPreference?: GeneratorPreference
): Promise<GeneratorSelection> {
  // Case 1: Explicit enabled array overrides everything
  if (userPreference?.enabled && userPreference.enabled.length > 0) {
    // Filter to only valid generators
    const validEnabled = userPreference.enabled.filter(isValidGenerator);
    const disabled = userPreference?.disabled ?? [];

    // Remove any explicitly disabled generators
    const finalEnabled = validEnabled.filter(id => !disabled.includes(id));

    return {
      enabled: finalEnabled,
      disabled,
      autoDetect: false,
      estimatedTotalTime: calculateEstimatedTime(finalEnabled),
    };
  }

  // Case 2: Auto-detect (default behavior)
  const autoDetect = userPreference?.autoDetect !== false;
  let enabled: string[] = [];
  let detectedIndustry: string | undefined;

  if (autoDetect) {
    // Detect industry from business input
    detectedIndustry = detectServiceType(businessInput);

    // Get all applicable generators for detected industry
    enabled = Object.values(GENERATOR_REGISTRY)
      .filter(
        config =>
          config.applicableIndustries.includes('*') ||
          config.applicableIndustries.includes(detectedIndustry!)
      )
      .map(config => config.id);
  } else {
    // No autoDetect and no explicit enabled = core only
    enabled = Object.values(GENERATOR_REGISTRY)
      .filter(config => config.category === 'core')
      .map(config => config.id);
  }

  // Remove disabled generators
  const disabled = userPreference?.disabled ?? [];
  enabled = enabled.filter(id => !disabled.includes(id));

  return {
    enabled,
    disabled,
    autoDetect,
    estimatedTotalTime: calculateEstimatedTime(enabled),
    detectedIndustry,
  };
}

/**
 * Detects the service/industry type from business input.
 *
 * Analyzes primary services to determine the most likely industry.
 * Returns 'general' if no specific industry can be determined.
 *
 * @param businessInput - The business input to analyze
 * @returns Detected industry type string
 */
export function detectServiceType(businessInput: BusinessInput): string {
  const primaryServices = businessInput.services?.primary ?? [];

  // Check each primary service against industry keywords
  for (const service of primaryServices) {
    const serviceLower = service.toLowerCase();

    for (const [keyword, industry] of Object.entries(INDUSTRY_KEYWORDS)) {
      if (serviceLower.includes(keyword)) {
        return industry;
      }
    }
  }

  // Also check the business name for industry hints
  const businessName = businessInput.business?.name?.toLowerCase() ?? '';
  for (const [keyword, industry] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (businessName.includes(keyword)) {
      return industry;
    }
  }

  return 'general';
}

/**
 * Gets the display name for an industry type.
 */
export function getIndustryDisplayName(industry: string): string {
  const displayNames: Record<string, string> = {
    plumbing: 'Plumbing',
    hvac: 'HVAC',
    electrical: 'Electrical',
    roofing: 'Roofing',
    contractor: 'General Contractor',
    realEstate: 'Real Estate',
    mortgage: 'Mortgage',
    lawyer: 'Legal Services',
    landscaping: 'Landscaping',
    pools: 'Pool & Spa',
    general: 'General Business',
  };

  return displayNames[industry] ?? industry;
}

/**
 * Validates generator preferences.
 * Returns list of validation errors (empty if valid).
 */
export function validateGeneratorPreference(preference: GeneratorPreference): string[] {
  const errors: string[] = [];

  // Validate enabled array
  if (preference.enabled) {
    const invalidEnabled = preference.enabled.filter(id => !isValidGenerator(id));
    if (invalidEnabled.length > 0) {
      errors.push(`Invalid generator IDs in enabled: ${invalidEnabled.join(', ')}`);
    }
  }

  // Validate disabled array
  if (preference.disabled) {
    const invalidDisabled = preference.disabled.filter(id => !isValidGenerator(id));
    if (invalidDisabled.length > 0) {
      errors.push(`Invalid generator IDs in disabled: ${invalidDisabled.join(', ')}`);
    }
  }

  return errors;
}
