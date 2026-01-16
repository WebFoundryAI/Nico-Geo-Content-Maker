/**
 * GEO Prompts Source Documentation
 *
 * This file documents the normalized prompt logic derived from
 * GEO content generation principles. Each section maps to a
 * specific generator in /core/generators/.
 *
 * IMPORTANT: This is reference documentation, not executable code.
 * The actual prompt logic is embedded as comments within each generator.
 */

/**
 * =============================================================================
 * TITLE & META GENERATOR PROMPTS
 * Generator: /core/generators/titleMeta.generator.ts
 * =============================================================================
 *
 * PRINCIPLE: Titles and meta descriptions must be factual and verifiable.
 *
 * TITLE CONSTRUCTION:
 * - Format: {Business Name} | {Primary Service} | in {City}
 * - Maximum length: ~60 characters
 * - Must include business name for brand recognition
 * - Must include location for local SEO signal
 * - Never include unverified superlatives ("best", "#1", "top-rated")
 *
 * META DESCRIPTION CONSTRUCTION:
 * - Format: {Business Name} provides {services} in {location}. {Service areas}.
 * - Maximum length: ~155 characters
 * - Must be factual summary of offerings
 * - Never include fabricated statistics or claims
 */

/**
 * =============================================================================
 * ANSWER CAPSULE GENERATOR PROMPTS
 * Generator: /core/generators/answerCapsule.generator.ts
 * =============================================================================
 *
 * PRINCIPLE: Answer capsules must directly answer implied search queries
 * in a format optimized for AI overview extraction.
 *
 * STRUCTURE:
 * - Sentence 1: Direct identification (who/what/where)
 * - Sentence 2: Service area coverage (if available)
 * - Sentence 3: Proof point (only if data provided)
 *
 * OPTIMIZATION TARGETS:
 * - Featured snippet eligibility
 * - AI overview extraction
 * - Entity recognition signals
 *
 * FORBIDDEN:
 * - Fabricated years of experience
 * - Made-up review counts or ratings
 * - Inferred service capabilities
 */

/**
 * =============================================================================
 * SERVICE DESCRIPTION GENERATOR PROMPTS
 * Generator: /core/generators/serviceDescription.generator.ts
 * =============================================================================
 *
 * PRINCIPLE: Each service must have a standalone description that
 * works for both human readers and search engine understanding.
 *
 * PRIMARY SERVICES:
 * - Full description with location context
 * - Credentials attached if available
 * - Call to action for contact
 *
 * SECONDARY SERVICES:
 * - Abbreviated mention
 * - Grouped as supplementary offerings
 *
 * FORBIDDEN:
 * - Fabricated specializations
 * - Made-up pricing
 * - Assumed capabilities beyond listed services
 */

/**
 * =============================================================================
 * FAQ GENERATOR PROMPTS
 * Generator: /core/generators/faq.generator.ts
 * =============================================================================
 *
 * PRINCIPLE: Only generate FAQ items that can be fully answered
 * with provided BusinessInput data.
 *
 * QUESTION CATEGORIES:
 * 1. Location: Where located? What areas served?
 * 2. Services: What do you offer?
 * 3. Credentials: Licensed? Insured? How long in business?
 * 4. Operations: Hours? Emergency service?
 * 5. Contact: How to reach?
 *
 * GENERATION RULES:
 * - Only generate if answer data exists
 * - Track unanswerable questions separately
 * - Format for FAQ schema compatibility
 *
 * FORBIDDEN:
 * - Answering questions with fabricated data
 * - Generating pricing FAQs without price data
 * - Creating comparison FAQs without competitor data
 */

/**
 * =============================================================================
 * SCHEMA.ORG GENERATOR PROMPTS
 * Generator: /core/generators/schema.generator.ts
 * =============================================================================
 *
 * PRINCIPLE: Structured data must be 100% accurate and verifiable.
 * Missing optional fields should be omitted, not fabricated.
 *
 * SCHEMA TYPE: LocalBusiness
 *
 * REQUIRED FIELDS:
 * - name (from business.name)
 *
 * CONDITIONAL FIELDS (only if data provided):
 * - url (from business.website or business.domain)
 * - telephone (from contact.phone)
 * - email (from contact.email)
 * - address (from location.*)
 * - areaServed (from location.serviceAreas)
 * - hasOfferCatalog (from services.*)
 * - aggregateRating (from proof.* - BOTH values required)
 * - openingHours (from operations.operatingHours)
 *
 * FORBIDDEN:
 * - Fabricating any schema property
 * - Including aggregateRating without both ratingValue AND reviewCount
 * - Adding priceRange without actual pricing data
 */

/**
 * =============================================================================
 * ANTI-HALLUCINATION PRINCIPLES
 * Enforced by: /core/rules/antiHallucination.ts
 * =============================================================================
 *
 * CORE RULE: If it's not in BusinessInput, it doesn't exist.
 *
 * SPECIFICALLY FORBIDDEN:
 * - Inferring years in business
 * - Guessing license types
 * - Assuming certifications
 * - Fabricating review counts or ratings
 * - Making up service areas
 * - Inventing staff counts or names
 * - Creating pricing information
 * - Generating project histories
 *
 * HANDLING MISSING DATA:
 * - Required fields: Use placeholder markers [DATA_REQUIRED: fieldName]
 * - Optional fields: Omit entirely
 * - Never fill gaps with "typical" or "common" values
 */

export {};
