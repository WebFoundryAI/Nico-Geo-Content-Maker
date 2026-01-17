/**
 * GEO Pipeline Output Contract
 *
 * Defines the canonical structure of GEO pipeline output.
 * This contract is the single source of truth for output shape.
 *
 * USAGE:
 * - Adapters must consume this structure
 * - Output validation should check against this contract
 * - No business-specific values are defined here
 */

/**
 * Pipeline metadata included in every output.
 */
export interface OutputMetadata {
  generatedAt: string;
  businessName: string;
  pipelineVersion: string;
}

/**
 * Title and meta description output.
 */
export interface TitleMetaContract {
  title: string;
  metaDescription: string;
  ogTitle?: string;
  ogDescription?: string;
  sources: string[];
}

/**
 * Answer capsule output for AI overview optimization.
 */
export interface AnswerCapsuleContract {
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
 * Individual service description item.
 */
export interface ServiceDescriptionItem {
  serviceName: string;
  description: string;
  locationContext: string;
  credentials?: string[];
  isPrimary: boolean;
}

/**
 * Service descriptions output.
 */
export interface ServiceDescriptionsContract {
  services: ServiceDescriptionItem[];
  summary: {
    totalServices: number;
    primaryCount: number;
    secondaryCount: number;
  };
  sources: string[];
}

/**
 * Individual FAQ item.
 */
export interface FAQItem {
  question: string;
  answer: string;
}

/**
 * FAQ output.
 */
export interface FAQContract {
  items: FAQItem[];
  schemaReady: FAQItem[];
  sources: string[];
}

/**
 * Schema.org LocalBusiness structured data.
 */
export interface LocalBusinessSchemaContract {
  '@context': 'https://schema.org';
  '@type': 'LocalBusiness';
  name: string;
  url?: string;
  telephone?: string;
  email?: string;
  address?: {
    '@type': 'PostalAddress';
    addressLocality: string;
    addressRegion?: string;
    addressCountry: string;
  };
  areaServed?: Array<{
    '@type': 'City' | 'State' | 'AdministrativeArea';
    name: string;
  }>;
  hasOfferCatalog?: {
    '@type': 'OfferCatalog';
    name: string;
    itemListElement: Array<{
      '@type': 'Offer';
      itemOffered: {
        '@type': 'Service';
        name: string;
      };
    }>;
  };
  aggregateRating?: {
    '@type': 'AggregateRating';
    ratingValue: number;
    reviewCount: number;
  };
  openingHours?: string;
}

/**
 * Schema output including JSON-LD string.
 */
export interface SchemaContract {
  localBusiness: LocalBusinessSchemaContract;
  jsonLd: string;
  validationNotes: string[];
  sources: string[];
}

// ============================================================
// NEW GENERATOR OUTPUT CONTRACTS (5 Generic Content Generators)
// ============================================================

/**
 * Individual differentiator item for "Why Choose Us" section.
 */
export interface WhyChooseUsDifferentiator {
  claim: string;
  proof: string;
  localContext: string;
  category: 'expertise' | 'experience' | 'local' | 'speed' | 'quality';
}

/**
 * Why Choose Us / Differentiators output.
 */
export interface WhyChooseUsContract {
  summary: string;
  differentiators: WhyChooseUsDifferentiator[];
  callToAction: string;
  sources: string[];
}

/**
 * Individual team member bio.
 */
export interface TeamMemberBioContract {
  name: string;
  role: string;
  bio: string;
  credentials: string[];
  specialties: string[];
  yearsExperience: number;
  trustSignals: string[];
  sources: string[];
}

/**
 * Team Bio output.
 */
export interface TeamBioContract {
  team: TeamMemberBioContract[];
  teamSummary: string;
  sources: string[];
}

/**
 * Individual process step for "How We Work" section.
 */
export interface ProcessStepContract {
  stepNumber: number;
  title: string;
  description: string;
  timeline: string;
  expectations: string[];
}

/**
 * How We Work / Service Process output.
 */
export interface HowWeWorkContract {
  intro: string;
  steps: ProcessStepContract[];
  totalTimeline: string;
  emergencyOption?: {
    available: boolean;
    timeline: string;
    description: string;
  };
  sources: string[];
}

/**
 * Individual case study result.
 */
export interface CaseStudyResultContract {
  metric: string;
  value: string;
}

/**
 * Individual case study.
 */
export interface CaseStudyItemContract {
  title: string;
  challenge: string;
  solution: string;
  results: CaseStudyResultContract[];
  projectType: string;
  location: string;
  clientAttribution?: string;
  sources: string[];
}

/**
 * Case Study output.
 */
export interface CaseStudyContract {
  caseStudies: CaseStudyItemContract[];
  summary: string;
  sources: string[];
}

/**
 * Individual enhanced testimonial.
 */
export interface EnhancedTestimonialContract {
  original: string;
  enhanced: string;
  attribution: {
    customerName: string;
    serviceReceived: string;
    date?: string;
    outcome?: string;
  };
  keyQuote: string;
  trustSignals: string[];
  sources: string[];
}

/**
 * Testimonial Enhancement output.
 */
export interface TestimonialContract {
  testimonials: EnhancedTestimonialContract[];
  summary: string;
  sources: string[];
}

/**
 * Complete GEO pipeline output contract.
 * This is the canonical shape that all adapters must consume.
 */
export interface GEOOutputContract {
  metadata: OutputMetadata;
  titleMeta: TitleMetaContract;
  answerCapsule: AnswerCapsuleContract;
  serviceDescriptions: ServiceDescriptionsContract;
  whyChooseUs?: WhyChooseUsContract;
  teamBios?: TeamBioContract;
  howWeWork?: HowWeWorkContract;
  caseStudies?: CaseStudyContract;
  testimonials?: TestimonialContract;
  faq: FAQContract;
  schema: SchemaContract;
  allSources: string[];
}

/**
 * Type guard to check if an object matches the output contract.
 */
export function isValidGEOOutput(output: unknown): output is GEOOutputContract {
  if (!output || typeof output !== 'object') {
    return false;
  }

  const o = output as Record<string, unknown>;

  return (
    typeof o.metadata === 'object' &&
    typeof o.titleMeta === 'object' &&
    typeof o.answerCapsule === 'object' &&
    typeof o.serviceDescriptions === 'object' &&
    typeof o.faq === 'object' &&
    typeof o.schema === 'object' &&
    Array.isArray(o.allSources)
  );
}

/**
 * Validates output against the contract, returning errors if invalid.
 */
export function validateGEOOutput(output: unknown): string[] {
  const errors: string[] = [];

  if (!output || typeof output !== 'object') {
    errors.push('Output must be a non-null object');
    return errors;
  }

  const o = output as Record<string, unknown>;

  // Check required top-level keys
  if (!o.metadata) errors.push('Missing required output section: metadata');
  if (!o.titleMeta) errors.push('Missing required output section: titleMeta');
  if (!o.answerCapsule) errors.push('Missing required output section: answerCapsule');
  if (!o.serviceDescriptions) errors.push('Missing required output section: serviceDescriptions');
  if (!o.faq) errors.push('Missing required output section: faq');
  if (!o.schema) errors.push('Missing required output section: schema');
  if (!Array.isArray(o.allSources)) errors.push('Missing required output section: allSources (must be array)');

  // Validate metadata structure
  if (o.metadata && typeof o.metadata === 'object') {
    const m = o.metadata as Record<string, unknown>;
    if (typeof m.generatedAt !== 'string') errors.push('metadata.generatedAt must be a string');
    if (typeof m.businessName !== 'string') errors.push('metadata.businessName must be a string');
    if (typeof m.pipelineVersion !== 'string') errors.push('metadata.pipelineVersion must be a string');
  }

  // Validate titleMeta structure
  if (o.titleMeta && typeof o.titleMeta === 'object') {
    const t = o.titleMeta as Record<string, unknown>;
    if (typeof t.title !== 'string') errors.push('titleMeta.title must be a string');
    if (typeof t.metaDescription !== 'string') errors.push('titleMeta.metaDescription must be a string');
  }

  // Validate answerCapsule structure
  if (o.answerCapsule && typeof o.answerCapsule === 'object') {
    const a = o.answerCapsule as Record<string, unknown>;
    if (typeof a.capsule !== 'string') errors.push('answerCapsule.capsule must be a string');
    if (!a.structuredAnswer || typeof a.structuredAnswer !== 'object') {
      errors.push('answerCapsule.structuredAnswer must be an object');
    }
  }

  // Validate serviceDescriptions structure
  if (o.serviceDescriptions && typeof o.serviceDescriptions === 'object') {
    const s = o.serviceDescriptions as Record<string, unknown>;
    if (!Array.isArray(s.services)) errors.push('serviceDescriptions.services must be an array');
    if (!s.summary || typeof s.summary !== 'object') {
      errors.push('serviceDescriptions.summary must be an object');
    }
  }

  // Validate faq structure
  if (o.faq && typeof o.faq === 'object') {
    const f = o.faq as Record<string, unknown>;
    if (!Array.isArray(f.schemaReady)) errors.push('faq.schemaReady must be an array');
  }

  // Validate schema structure
  if (o.schema && typeof o.schema === 'object') {
    const s = o.schema as Record<string, unknown>;
    if (typeof s.jsonLd !== 'string') errors.push('schema.jsonLd must be a string');
    if (!s.localBusiness || typeof s.localBusiness !== 'object') {
      errors.push('schema.localBusiness must be an object');
    }
  }

  return errors;
}
