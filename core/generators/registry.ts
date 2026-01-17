/**
 * Generator Registry
 *
 * Central registry of all available content generators.
 * Defines configuration for core (universal) and industry-specific generators.
 *
 * CATEGORIES:
 * - 'core': Universal generators applicable to all industries
 * - 'industry': Specialized generators for specific verticals
 *
 * APPLICABILITY:
 * - '*' means generator applies to all industries
 * - Specific industry strings limit generator availability
 */

/**
 * Configuration for a single generator.
 */
export interface GeneratorConfig {
  /** Unique identifier for the generator */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category: 'core' (all industries) or 'industry' (specific verticals) */
  category: 'core' | 'industry';
  /** Which industries this generator applies to ('*' = all) */
  applicableIndustries: string[];
  /** Estimated execution time in milliseconds */
  estimatedTime: number;
}

/**
 * Central registry of all generators.
 * Maps generator ID to its configuration.
 */
export const GENERATOR_REGISTRY: Record<string, GeneratorConfig> = {
  // ============================================================
  // CORE GENERATORS (All Industries)
  // ============================================================
  titleMeta: {
    id: 'titleMeta',
    name: 'Title & Meta',
    category: 'core',
    applicableIndustries: ['*'],
    estimatedTime: 2000,
  },
  answerCapsule: {
    id: 'answerCapsule',
    name: 'Answer Capsule',
    category: 'core',
    applicableIndustries: ['*'],
    estimatedTime: 2000,
  },
  serviceDescription: {
    id: 'serviceDescription',
    name: 'Service Descriptions',
    category: 'core',
    applicableIndustries: ['*'],
    estimatedTime: 3000,
  },
  whyChooseUs: {
    id: 'whyChooseUs',
    name: 'Why Choose Us',
    category: 'core',
    applicableIndustries: ['*'],
    estimatedTime: 2500,
  },
  teamBio: {
    id: 'teamBio',
    name: 'Team Bios',
    category: 'core',
    applicableIndustries: ['*'],
    estimatedTime: 3000,
  },
  howWeWork: {
    id: 'howWeWork',
    name: 'How We Work',
    category: 'core',
    applicableIndustries: ['*'],
    estimatedTime: 2500,
  },
  caseStudy: {
    id: 'caseStudy',
    name: 'Case Studies',
    category: 'core',
    applicableIndustries: ['*'],
    estimatedTime: 3500,
  },
  testimonial: {
    id: 'testimonial',
    name: 'Testimonials',
    category: 'core',
    applicableIndustries: ['*'],
    estimatedTime: 2500,
  },
  faq: {
    id: 'faq',
    name: 'FAQs',
    category: 'core',
    applicableIndustries: ['*'],
    estimatedTime: 3000,
  },
  schema: {
    id: 'schema',
    name: 'Schema Markup',
    category: 'core',
    applicableIndustries: ['*'],
    estimatedTime: 2000,
  },

  // ============================================================
  // INDUSTRY-SPECIFIC GENERATORS
  // ============================================================

  /**
   * Property Market Data Generator
   * Generates local market statistics, pricing trends, and hot areas.
   * Applicable to: Real Estate, Mortgage
   */
  propertyMarketData: {
    id: 'propertyMarketData',
    name: 'Property Market Data',
    category: 'industry',
    applicableIndustries: ['realEstate', 'mortgage'],
    estimatedTime: 8000,
  },

  /**
   * Permits & Building Codes Generator
   * Generates jurisdiction-specific permit requirements and building codes.
   * Applicable to: Plumbing, HVAC, Electrical, Roofing, General Contractor
   */
  permitsAndCodes: {
    id: 'permitsAndCodes',
    name: 'Permits & Codes',
    category: 'industry',
    applicableIndustries: ['plumbing', 'hvac', 'electrical', 'roofing', 'contractor'],
    estimatedTime: 10000,
  },

  /**
   * Local Court Process Generator
   * Generates local court procedures, timelines, and filing requirements.
   * Applicable to: Lawyers, Attorneys
   */
  localCourtProcess: {
    id: 'localCourtProcess',
    name: 'Local Court Process',
    category: 'industry',
    applicableIndustries: ['lawyer', 'attorney'],
    estimatedTime: 10000,
  },

  /**
   * First-Time Buyer Programs Generator
   * Generates federal, state, and local buyer assistance programs.
   * Applicable to: Mortgage, Real Estate
   */
  firstTimeBuyerPrograms: {
    id: 'firstTimeBuyerPrograms',
    name: 'Buyer Programs',
    category: 'industry',
    applicableIndustries: ['mortgage', 'realEstate'],
    estimatedTime: 8000,
  },

  /**
   * Seasonal & Climate Generator
   * Generates seasonal service timing and weather-related content.
   * Applicable to: HVAC, Roofing, Landscaping, Pools
   */
  seasonalClimate: {
    id: 'seasonalClimate',
    name: 'Seasonal & Climate',
    category: 'industry',
    applicableIndustries: ['hvac', 'roofing', 'landscaping', 'pools'],
    estimatedTime: 6000,
  },
};

/**
 * Gets all generator IDs for a specific category.
 */
export function getGeneratorsByCategory(category: 'core' | 'industry'): string[] {
  return Object.values(GENERATOR_REGISTRY)
    .filter(config => config.category === category)
    .map(config => config.id);
}

/**
 * Gets all generator IDs applicable to a specific industry.
 */
export function getGeneratorsForIndustry(industry: string): string[] {
  return Object.values(GENERATOR_REGISTRY)
    .filter(
      config =>
        config.applicableIndustries.includes('*') ||
        config.applicableIndustries.includes(industry)
    )
    .map(config => config.id);
}

/**
 * Calculates total estimated time for a set of generators.
 */
export function calculateEstimatedTime(generatorIds: string[]): number {
  return generatorIds.reduce((sum, id) => {
    const config = GENERATOR_REGISTRY[id];
    return sum + (config?.estimatedTime ?? 5000);
  }, 0);
}

/**
 * Validates that a generator ID exists in the registry.
 */
export function isValidGenerator(id: string): boolean {
  return id in GENERATOR_REGISTRY;
}

/**
 * Gets configuration for a specific generator.
 */
export function getGeneratorConfig(id: string): GeneratorConfig | undefined {
  return GENERATOR_REGISTRY[id];
}
