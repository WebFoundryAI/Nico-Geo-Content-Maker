/**
 * GEO Gap Analyzer
 *
 * Analyzes ingested page data against GEO readiness requirements.
 * Produces structured gap analysis without fabricating business facts.
 *
 * GEO READINESS CHECKS:
 * - Title quality (present, sufficient length)
 * - Meta description (present)
 * - H1 heading (present)
 * - FAQ section (heuristic detection)
 * - Schema.org markup (detected types)
 * - Content depth (text length threshold)
 * - Answer capsule opportunity
 * - Internal linking health
 */

import type { PageData, CrawlResult } from '../ingest/siteCrawler';

/**
 * Thresholds for gap analysis.
 */
export const GAP_THRESHOLDS = {
  minTitleLength: 20,
  minMetaDescriptionLength: 50,
  maxMetaDescriptionLength: 160,
  minContentLength: 500,
  minInternalLinksOut: 2,
} as const;

/**
 * Gap flag for a specific issue.
 */
export interface GapFlag {
  type: string;
  severity: 'critical' | 'warning' | 'suggestion';
  message: string;
  currentValue?: string | number | null;
  recommendation: string;
}

/**
 * Analysis result for a single page.
 */
export interface PageGapAnalysis {
  url: string;
  httpStatus: number;
  gaps: GapFlag[];
  geoScore: number; // 0-100 score based on readiness
  isServicePage: boolean;
  isLocationPage: boolean;
}

/**
 * Overall site analysis result.
 */
export interface SiteGapAnalysis {
  siteUrl: string;
  analyzedAt: string;
  totalPages: number;
  pagesWithGaps: number;
  averageGeoScore: number;
  criticalIssues: number;
  warnings: number;
  suggestions: number;
  pages: PageGapAnalysis[];
  siteWideIssues: GapFlag[];
}

/**
 * Heuristically detects if a page is service-related.
 */
function isServicePage(page: PageData): boolean {
  const indicators = [
    'service',
    'services',
    'what-we-do',
    'solutions',
    'offerings',
    'products',
  ];
  const urlLower = page.url.toLowerCase();
  const titleLower = (page.title || '').toLowerCase();
  const h1Lower = (page.h1Text || '').toLowerCase();

  return indicators.some(
    ind => urlLower.includes(ind) || titleLower.includes(ind) || h1Lower.includes(ind)
  );
}

/**
 * Heuristically detects if a page is location-related.
 */
function isLocationPage(page: PageData): boolean {
  const indicators = [
    'location',
    'locations',
    'areas',
    'service-area',
    'coverage',
    'near-me',
    'city',
    'region',
  ];
  const urlLower = page.url.toLowerCase();
  const titleLower = (page.title || '').toLowerCase();

  return indicators.some(ind => urlLower.includes(ind) || titleLower.includes(ind));
}

/**
 * Heuristically detects if page has FAQ content.
 */
function hasFAQContent(page: PageData): boolean {
  // Check if FAQ schema is present
  if (page.detectedSchemaTypes.some(t => t.toLowerCase().includes('faq'))) {
    return true;
  }

  // Check URL for FAQ indicators
  const urlLower = page.url.toLowerCase();
  if (urlLower.includes('faq') || urlLower.includes('frequently-asked')) {
    return true;
  }

  return false;
}

/**
 * Analyzes a single page for GEO gaps.
 */
function analyzePageGaps(page: PageData, allPages: PageData[]): PageGapAnalysis {
  const gaps: GapFlag[] = [];
  let geoScore = 100;

  const servicePageFlag = isServicePage(page);
  const locationPageFlag = isLocationPage(page);

  // Check HTTP status
  if (page.httpStatus !== 200) {
    gaps.push({
      type: 'http_error',
      severity: 'critical',
      message: `Page returned HTTP ${page.httpStatus}`,
      currentValue: page.httpStatus,
      recommendation: 'Fix server response to return 200 OK',
    });
    geoScore -= 30;
  }

  // Check title
  if (!page.title) {
    gaps.push({
      type: 'missing_title',
      severity: 'critical',
      message: 'Page is missing a title tag',
      currentValue: null,
      recommendation: 'Add a descriptive title tag (20-60 characters)',
    });
    geoScore -= 20;
  } else if (page.title.length < GAP_THRESHOLDS.minTitleLength) {
    gaps.push({
      type: 'weak_title',
      severity: 'warning',
      message: `Title is too short (${page.title.length} chars)`,
      currentValue: page.title,
      recommendation: `Expand title to at least ${GAP_THRESHOLDS.minTitleLength} characters with relevant keywords`,
    });
    geoScore -= 10;
  }

  // Check meta description
  if (!page.metaDescription) {
    gaps.push({
      type: 'missing_meta_description',
      severity: 'critical',
      message: 'Page is missing a meta description',
      currentValue: null,
      recommendation: 'Add a compelling meta description (50-160 characters)',
    });
    geoScore -= 15;
  } else if (page.metaDescription.length < GAP_THRESHOLDS.minMetaDescriptionLength) {
    gaps.push({
      type: 'short_meta_description',
      severity: 'warning',
      message: `Meta description is too short (${page.metaDescription.length} chars)`,
      currentValue: page.metaDescription,
      recommendation: `Expand to at least ${GAP_THRESHOLDS.minMetaDescriptionLength} characters`,
    });
    geoScore -= 5;
  }

  // Check H1
  if (!page.h1Text) {
    gaps.push({
      type: 'missing_h1',
      severity: 'critical',
      message: 'Page is missing an H1 heading',
      currentValue: null,
      recommendation: 'Add a clear H1 heading that matches page intent',
    });
    geoScore -= 15;
  }

  // Check FAQ
  if (!hasFAQContent(page) && (servicePageFlag || locationPageFlag)) {
    gaps.push({
      type: 'no_faq_detected',
      severity: 'suggestion',
      message: 'No FAQ section detected on this service/location page',
      currentValue: null,
      recommendation: 'Add an FAQ section with FAQPage schema markup',
    });
    geoScore -= 5;
  }

  // Check schema
  if (page.detectedSchemaTypes.length === 0) {
    gaps.push({
      type: 'no_schema_detected',
      severity: 'warning',
      message: 'No schema.org structured data detected',
      currentValue: null,
      recommendation: 'Add LocalBusiness, Service, or FAQPage schema as appropriate',
    });
    geoScore -= 10;
  }

  // Check content depth
  if (page.contentTextLength < GAP_THRESHOLDS.minContentLength) {
    gaps.push({
      type: 'low_content_depth',
      severity: 'warning',
      message: `Page has thin content (${page.contentTextLength} chars)`,
      currentValue: page.contentTextLength,
      recommendation: `Expand content to at least ${GAP_THRESHOLDS.minContentLength} characters`,
    });
    geoScore -= 10;
  }

  // Check answer capsule opportunity
  if (servicePageFlag || locationPageFlag) {
    gaps.push({
      type: 'answer_capsule_opportunity',
      severity: 'suggestion',
      message: 'This page could benefit from an answer capsule for AI overview optimization',
      currentValue: null,
      recommendation: 'Add a 2-3 sentence answer capsule near the top of the page',
    });
    // No score deduction - this is an opportunity, not a problem
  }

  // Check internal linking
  if (page.internalLinks.length < GAP_THRESHOLDS.minInternalLinksOut) {
    gaps.push({
      type: 'weak_internal_linking',
      severity: 'warning',
      message: `Page has few outbound internal links (${page.internalLinks.length})`,
      currentValue: page.internalLinks.length,
      recommendation: `Add at least ${GAP_THRESHOLDS.minInternalLinksOut} relevant internal links`,
    });
    geoScore -= 5;
  }

  // Check if page is orphaned (no incoming links from other crawled pages)
  const incomingLinks = allPages.filter(p =>
    p.url !== page.url && p.internalLinks.includes(page.url)
  );
  if (incomingLinks.length === 0 && allPages.length > 1) {
    gaps.push({
      type: 'orphan_candidate',
      severity: 'warning',
      message: 'Page may be orphaned (no incoming links detected from crawled pages)',
      currentValue: 0,
      recommendation: 'Add internal links from other pages to improve discoverability',
    });
    geoScore -= 5;
  }

  // Ensure score doesn't go below 0
  geoScore = Math.max(0, geoScore);

  return {
    url: page.url,
    httpStatus: page.httpStatus,
    gaps,
    geoScore,
    isServicePage: servicePageFlag,
    isLocationPage: locationPageFlag,
  };
}

/**
 * Analyzes site-wide issues that span multiple pages.
 */
function analyzeSiteWideIssues(pages: PageData[]): GapFlag[] {
  const issues: GapFlag[] = [];

  // Check for duplicate titles
  const titles = pages.filter(p => p.title).map(p => p.title!);
  const duplicateTitles = titles.filter((t, i) => titles.indexOf(t) !== i);
  if (duplicateTitles.length > 0) {
    issues.push({
      type: 'duplicate_titles',
      severity: 'warning',
      message: `${new Set(duplicateTitles).size} pages have duplicate titles`,
      currentValue: duplicateTitles.length,
      recommendation: 'Ensure each page has a unique, descriptive title',
    });
  }

  // Check for missing canonicals across multiple pages
  const missingCanonicals = pages.filter(p => !p.canonical && p.httpStatus === 200);
  if (missingCanonicals.length > pages.length / 2) {
    issues.push({
      type: 'missing_canonicals',
      severity: 'suggestion',
      message: `${missingCanonicals.length} pages are missing canonical tags`,
      currentValue: missingCanonicals.length,
      recommendation: 'Add canonical tags to prevent duplicate content issues',
    });
  }

  // Check for low schema adoption
  const pagesWithSchema = pages.filter(p => p.detectedSchemaTypes.length > 0);
  if (pagesWithSchema.length < pages.length / 3) {
    issues.push({
      type: 'low_schema_adoption',
      severity: 'warning',
      message: `Only ${pagesWithSchema.length} of ${pages.length} pages have schema markup`,
      currentValue: pagesWithSchema.length,
      recommendation: 'Implement schema.org markup site-wide for better search visibility',
    });
  }

  return issues;
}

/**
 * Analyzes a crawl result for GEO readiness gaps.
 */
export function analyzeGeoGaps(crawlResult: CrawlResult): SiteGapAnalysis {
  const pageAnalyses = crawlResult.pages.map(page =>
    analyzePageGaps(page, crawlResult.pages)
  );

  const siteWideIssues = analyzeSiteWideIssues(crawlResult.pages);

  // Calculate summary stats
  const pagesWithGaps = pageAnalyses.filter(p => p.gaps.length > 0).length;
  const averageGeoScore =
    pageAnalyses.length > 0
      ? pageAnalyses.reduce((sum, p) => sum + p.geoScore, 0) / pageAnalyses.length
      : 0;

  let criticalIssues = 0;
  let warnings = 0;
  let suggestions = 0;

  for (const analysis of pageAnalyses) {
    for (const gap of analysis.gaps) {
      if (gap.severity === 'critical') criticalIssues++;
      else if (gap.severity === 'warning') warnings++;
      else suggestions++;
    }
  }

  for (const issue of siteWideIssues) {
    if (issue.severity === 'critical') criticalIssues++;
    else if (issue.severity === 'warning') warnings++;
    else suggestions++;
  }

  return {
    siteUrl: crawlResult.baseUrl,
    analyzedAt: new Date().toISOString(),
    totalPages: crawlResult.pagesAnalyzed,
    pagesWithGaps,
    averageGeoScore: Math.round(averageGeoScore),
    criticalIssues,
    warnings,
    suggestions,
    pages: pageAnalyses,
    siteWideIssues,
  };
}
