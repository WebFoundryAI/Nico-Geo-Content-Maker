/**
 * Improvement Planner
 *
 * Generates PATCH-READY improvement blocks based on gap analysis.
 * All improvements are based only on existing page content plus
 * generic GEO patterns - no fabricated business facts.
 *
 * DESIGN CONSTRAINTS:
 * - No invented claims (licenses, years, ratings, etc.)
 * - Use "[ADD FACT]" placeholders where data is needed
 * - Improvements are additive suggestions, not rewrites
 * - Output is structured for easy integration
 */

import type { PageData, CrawlResult } from '../ingest/siteCrawler';
import type { PageGapAnalysis, SiteGapAnalysis, GapFlag } from './geoGapAnalyzer';
import { analyzeGeoGaps } from './geoGapAnalyzer';

/**
 * Suggested FAQ item.
 */
export interface SuggestedFAQ {
  question: string;
  answer: string;
  isPlaceholder: boolean;
}

/**
 * Suggested schema.org additions.
 */
export interface SuggestedSchema {
  '@context': 'https://schema.org';
  '@type': string;
  [key: string]: unknown;
}

/**
 * Suggested additions for a page.
 */
export interface SuggestedAdditions {
  answerCapsule?: string;
  faq?: SuggestedFAQ[];
  schemaJsonLd?: SuggestedSchema;
}

/**
 * Improvement plan for a single page.
 */
export interface PageImprovementPlan {
  url: string;
  currentState: {
    title: string | null;
    metaDescription: string | null;
    h1: string | null;
    hasSchema: boolean;
    contentLength: number;
  };
  recommendedTitle: string | null;
  recommendedMetaDescription: string | null;
  suggestedAdditions: SuggestedAdditions;
  priorityActions: string[];
  estimatedImpact: 'high' | 'medium' | 'low';
}

/**
 * Full improvement plan for a site.
 */
export interface SiteImprovementPlan {
  siteUrl: string;
  generatedAt: string;
  totalPages: number;
  pagesWithImprovements: number;
  pages: PageImprovementPlan[];
  siteWideSuggestions: string[];
}

/**
 * Extracts key facts from page content for use in improvements.
 * Only uses what's actually present - never fabricates.
 */
function extractPageFacts(page: PageData): {
  businessName: string | null;
  location: string | null;
  services: string[];
} {
  // Try to extract business name from title or H1
  let businessName: string | null = null;
  if (page.title) {
    // Common patterns: "Business Name | ...", "Business Name - ...", "... | Business Name"
    const titleParts = page.title.split(/[|\-–—]/);
    if (titleParts.length > 0) {
      businessName = titleParts[0].trim();
      // If first part is generic, try last part
      if (businessName.toLowerCase().includes('home') || businessName.length < 3) {
        businessName = titleParts[titleParts.length - 1].trim();
      }
    }
  }

  // Try to detect location from URL or content
  let location: string | null = null;
  // This is very basic - in production we'd use more sophisticated extraction
  const urlLower = page.url.toLowerCase();
  const locationPatterns = [
    /\/([a-z]+(?:-[a-z]+)*)\/?$/i, // /city-name or /city-name/
  ];
  for (const pattern of locationPatterns) {
    const match = urlLower.match(pattern);
    if (match && match[1] && match[1].length > 2 && !match[1].includes('.')) {
      // Convert hyphenated to title case
      location = match[1]
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      break;
    }
  }

  // Services detection is very limited without full content parsing
  const services: string[] = [];

  return { businessName, location, services };
}

/**
 * Generates a recommended title based on existing page data.
 */
function generateRecommendedTitle(page: PageData, gaps: GapFlag[]): string | null {
  const hasGap = gaps.some(g => g.type === 'missing_title' || g.type === 'weak_title');
  if (!hasGap) return null;

  const facts = extractPageFacts(page);

  if (page.h1Text && page.h1Text.length >= 20) {
    // H1 is good enough to use as title base
    if (facts.location) {
      return `${page.h1Text} in ${facts.location} | [ADD BUSINESS NAME]`;
    }
    return `${page.h1Text} | [ADD BUSINESS NAME]`;
  }

  if (facts.businessName) {
    if (facts.location) {
      return `[ADD SERVICE] in ${facts.location} | ${facts.businessName}`;
    }
    return `[ADD SERVICE DESCRIPTION] | ${facts.businessName}`;
  }

  return '[ADD DESCRIPTIVE TITLE - Include: Primary Service, Location, Business Name]';
}

/**
 * Generates a recommended meta description based on existing page data.
 */
function generateRecommendedMetaDescription(page: PageData, gaps: GapFlag[]): string | null {
  const hasGap = gaps.some(
    g => g.type === 'missing_meta_description' || g.type === 'short_meta_description'
  );
  if (!hasGap) return null;

  const facts = extractPageFacts(page);

  if (facts.businessName && facts.location) {
    return `${facts.businessName} provides [ADD SERVICES] in ${facts.location}. [ADD UNIQUE VALUE PROPOSITION]. Contact us for [ADD CALL TO ACTION].`;
  }

  if (facts.businessName) {
    return `${facts.businessName} offers [ADD SERVICES]. [ADD UNIQUE VALUE PROPOSITION]. [ADD CALL TO ACTION].`;
  }

  return '[ADD BUSINESS NAME] provides [ADD SERVICES] in [ADD LOCATION]. [ADD VALUE PROPOSITION]. [ADD CALL TO ACTION].';
}

/**
 * Generates a suggested answer capsule.
 */
function generateAnswerCapsule(
  page: PageData,
  isServicePage: boolean,
  isLocationPage: boolean
): string | null {
  if (!isServicePage && !isLocationPage) return null;

  const facts = extractPageFacts(page);

  if (facts.businessName && facts.location) {
    return `${facts.businessName} is a [ADD SERVICE TYPE] provider located in ${facts.location}. [ADD 1-2 SENTENCES ABOUT KEY OFFERINGS OR DIFFERENTIATORS]. Contact [ADD CONTACT METHOD] for more information.`;
  }

  if (facts.businessName) {
    return `${facts.businessName} provides [ADD SERVICE DESCRIPTION]. [ADD KEY DIFFERENTIATOR OR PROOF POINT]. [ADD CALL TO ACTION].`;
  }

  return '[BUSINESS NAME] is a [SERVICE TYPE] provider in [LOCATION]. [ADD 1-2 SENTENCES DESCRIBING SERVICES]. [CALL TO ACTION].';
}

/**
 * Generates suggested FAQ items.
 */
function generateSuggestedFAQs(
  page: PageData,
  isServicePage: boolean,
  isLocationPage: boolean
): SuggestedFAQ[] | undefined {
  // Only suggest FAQs for service or location pages
  if (!isServicePage && !isLocationPage) return undefined;

  const facts = extractPageFacts(page);
  const faqs: SuggestedFAQ[] = [];

  if (isServicePage) {
    faqs.push({
      question: `What services does ${facts.businessName || '[BUSINESS NAME]'} offer?`,
      answer: '[LIST PRIMARY SERVICES AND BRIEF DESCRIPTIONS]',
      isPlaceholder: true,
    });
    faqs.push({
      question: `How can I contact ${facts.businessName || '[BUSINESS NAME]'}?`,
      answer: '[ADD CONTACT METHODS: PHONE, EMAIL, CONTACT FORM URL]',
      isPlaceholder: true,
    });
    faqs.push({
      question: `What areas does ${facts.businessName || '[BUSINESS NAME]'} serve?`,
      answer: '[LIST SERVICE AREAS OR COVERAGE]',
      isPlaceholder: true,
    });
  }

  if (isLocationPage && facts.location) {
    faqs.push({
      question: `Does ${facts.businessName || '[BUSINESS NAME]'} provide services in ${facts.location}?`,
      answer: `Yes, ${facts.businessName || '[BUSINESS NAME]'} serves ${facts.location} and surrounding areas. [ADD SPECIFIC DETAILS ABOUT LOCAL SERVICE]`,
      isPlaceholder: true,
    });
  }

  return faqs.length > 0 ? faqs : undefined;
}

/**
 * Generates suggested schema.org markup.
 */
function generateSuggestedSchema(
  page: PageData,
  isServicePage: boolean,
  isLocationPage: boolean
): SuggestedSchema | undefined {
  // Don't suggest if schema already exists
  if (page.detectedSchemaTypes.length > 0) return undefined;

  const facts = extractPageFacts(page);

  if (isServicePage || isLocationPage) {
    return {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: facts.businessName || '[ADD BUSINESS NAME]',
      description: '[ADD BUSINESS DESCRIPTION]',
      url: page.url,
      address: {
        '@type': 'PostalAddress',
        addressLocality: facts.location || '[ADD CITY]',
        addressRegion: '[ADD STATE/REGION]',
        addressCountry: '[ADD COUNTRY]',
      },
      telephone: '[ADD PHONE NUMBER]',
      email: '[ADD EMAIL]',
      areaServed: '[ADD SERVICE AREAS]',
    };
  }

  return undefined;
}

/**
 * Determines priority actions based on gaps.
 */
function determinePriorityActions(gaps: GapFlag[]): string[] {
  const actions: string[] = [];
  const criticalGaps = gaps.filter(g => g.severity === 'critical');
  const warningGaps = gaps.filter(g => g.severity === 'warning');

  // Add critical actions first
  for (const gap of criticalGaps) {
    actions.push(`CRITICAL: ${gap.recommendation}`);
  }

  // Add up to 3 warning actions
  for (const gap of warningGaps.slice(0, 3)) {
    actions.push(`${gap.recommendation}`);
  }

  return actions;
}

/**
 * Estimates improvement impact based on current state and gaps.
 */
function estimateImpact(page: PageData, gaps: GapFlag[]): 'high' | 'medium' | 'low' {
  const criticalCount = gaps.filter(g => g.severity === 'critical').length;

  if (criticalCount >= 3) return 'high';
  if (criticalCount >= 1) return 'medium';
  return 'low';
}

/**
 * Generates an improvement plan for a single page.
 */
function planPageImprovements(
  page: PageData,
  gapAnalysis: PageGapAnalysis
): PageImprovementPlan {
  const recommendedTitle = generateRecommendedTitle(page, gapAnalysis.gaps);
  const recommendedMetaDescription = generateRecommendedMetaDescription(page, gapAnalysis.gaps);

  const suggestedAdditions: SuggestedAdditions = {};

  // Add answer capsule if opportunity identified
  const hasOpportunity = gapAnalysis.gaps.some(g => g.type === 'answer_capsule_opportunity');
  if (hasOpportunity) {
    const capsule = generateAnswerCapsule(
      page,
      gapAnalysis.isServicePage,
      gapAnalysis.isLocationPage
    );
    if (capsule) {
      suggestedAdditions.answerCapsule = capsule;
    }
  }

  // Add FAQ suggestions if no FAQ detected
  const noFAQ = gapAnalysis.gaps.some(g => g.type === 'no_faq_detected');
  if (noFAQ) {
    const faqs = generateSuggestedFAQs(
      page,
      gapAnalysis.isServicePage,
      gapAnalysis.isLocationPage
    );
    if (faqs) {
      suggestedAdditions.faq = faqs;
    }
  }

  // Add schema suggestion if no schema detected
  const noSchema = gapAnalysis.gaps.some(g => g.type === 'no_schema_detected');
  if (noSchema) {
    const schema = generateSuggestedSchema(
      page,
      gapAnalysis.isServicePage,
      gapAnalysis.isLocationPage
    );
    if (schema) {
      suggestedAdditions.schemaJsonLd = schema;
    }
  }

  return {
    url: page.url,
    currentState: {
      title: page.title,
      metaDescription: page.metaDescription,
      h1: page.h1Text,
      hasSchema: page.detectedSchemaTypes.length > 0,
      contentLength: page.contentTextLength,
    },
    recommendedTitle,
    recommendedMetaDescription,
    suggestedAdditions,
    priorityActions: determinePriorityActions(gapAnalysis.gaps),
    estimatedImpact: estimateImpact(page, gapAnalysis.gaps),
  };
}

/**
 * Generates site-wide suggestions based on gap analysis.
 */
function generateSiteWideSuggestions(gapAnalysis: SiteGapAnalysis): string[] {
  const suggestions: string[] = [];

  for (const issue of gapAnalysis.siteWideIssues) {
    suggestions.push(issue.recommendation);
  }

  // Add generic GEO recommendations
  if (gapAnalysis.averageGeoScore < 50) {
    suggestions.push(
      'Consider a comprehensive GEO audit - average page score is below 50%'
    );
  }

  if (gapAnalysis.criticalIssues > gapAnalysis.totalPages) {
    suggestions.push(
      'Multiple critical issues per page detected - prioritize title and meta description fixes'
    );
  }

  return suggestions;
}

/**
 * Generates a complete improvement plan for a site.
 */
export function planSiteImprovements(crawlResult: CrawlResult): SiteImprovementPlan {
  // First, run gap analysis
  const gapAnalysis = analyzeGeoGaps(crawlResult);

  // Generate improvement plans for each page
  const pageImprovements: PageImprovementPlan[] = [];

  for (let i = 0; i < crawlResult.pages.length; i++) {
    const page = crawlResult.pages[i];
    const pageGaps = gapAnalysis.pages.find(p => p.url === page.url);

    if (pageGaps) {
      pageImprovements.push(planPageImprovements(page, pageGaps));
    }
  }

  // Filter to only pages that actually have improvements
  const pagesWithImprovements = pageImprovements.filter(
    p =>
      p.recommendedTitle ||
      p.recommendedMetaDescription ||
      Object.keys(p.suggestedAdditions).length > 0
  );

  return {
    siteUrl: crawlResult.baseUrl,
    generatedAt: new Date().toISOString(),
    totalPages: crawlResult.pagesAnalyzed,
    pagesWithImprovements: pagesWithImprovements.length,
    pages: pageImprovements,
    siteWideSuggestions: generateSiteWideSuggestions(gapAnalysis),
  };
}
