/**
 * Nico GEO Audit Worker - Production Engine
 * Real HTML inspection with evidence-based findings
 */

// ============================================================
// TYPE DEFINITIONS
// ============================================================

interface Issue {
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  evidence: string;
  impact: string;
  recommendation: string;
}

interface AuditResponse {
  siteUrl: string;
  score: number;
  topIssues: Issue[];
  issuesByPriority: {
    critical: Issue[];
    high: Issue[];
    medium: Issue[];
    low: Issue[];
  };
}

interface PageSignals {
  url: string;
  title: string;
  metaDescription: string;
  h1Count: number;
  h1Text: string;
  h2s: string[];
  h3s: string[];
  h4Count: number;
  h5Count: number;
  h6Count: number;
  wordCount: number;
  bodyText: string;
  internalLinks: string[];
  internalLinkCount: number;
  externalLinkCount: number;
  anchorTexts: string[];
  imageCount: number;
  imagesWithAlt: number;
  imagesMissingAlt: string[];
  jsonLdTypes: string[];
  hasLocalBusinessSchema: boolean;
  hasOrganizationSchema: boolean;
  hasServiceSchema: boolean;
  schemaDetails: string[];
  hasGeoKeywords: boolean;
  hasServiceKeywords: boolean;
  geoTermsFound: string[];
  serviceTermsFound: string[];
  robotsNoindex: boolean;
  canonicalUrl: string;
  hasPhone: boolean;
  phoneNumbers: string[];
  hasEmail: boolean;
  emails: string[];
  hasAddress: boolean;
  addressSignals: string[];
  napConsistent: boolean;
  isServicePage: boolean;
  isLocationPage: boolean;
}

interface AuditContext {
  homepage: PageSignals;
  crawledPages: PageSignals[];
  allPages: PageSignals[];
}

// ============================================================
// CONSTANTS
// ============================================================

const WEIGHTS: Record<string, number> = {
  critical: 20,
  high: 12,
  medium: 6,
  low: 2,
};

// Specific city/location names (not generic words)
const GEO_CITY_TERMS = [
  'london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'liverpool', 'bristol',
  'sheffield', 'edinburgh', 'cardiff', 'belfast', 'newcastle', 'nottingham',
  'southampton', 'portsmouth', 'york', 'cambridge', 'oxford', 'brighton', 'bath',
  'new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia',
  'san antonio', 'san diego', 'dallas', 'san jose', 'austin', 'jacksonville',
  'fort worth', 'columbus', 'charlotte', 'seattle', 'denver', 'boston', 'portland',
  'miami', 'atlanta', 'detroit', 'minneapolis', 'tampa', 'brooklyn', 'queens',
];

// Local intent phrases (more specific than just "local")
const GEO_INTENT_TERMS = [
  'near me', 'nearby', 'service area', 'located in', 'based in', 'serving',
  'in your area', 'locations', 'find us',
];

// Specific service industry terms (not generic business words)
const SERVICE_INDUSTRY_TERMS = [
  'plumber', 'plumbing', 'electrician', 'electrical', 'hvac', 'heating', 'cooling',
  'roofing', 'roofer', 'contractor', 'construction', 'landscaping', 'landscaper',
  'cleaning', 'cleaner', 'painting', 'painter', 'carpentry', 'carpenter',
  'locksmith', 'pest control', 'moving', 'mover', 'handyman', 'remodeling',
  'renovation', 'repair', 'installation', 'maintenance',
];

// Local service intent signals
const SERVICE_INTENT_TERMS = [
  'emergency', '24/7', 'same day', 'free estimate', 'free quote',
  'licensed', 'insured', 'certified', 'bonded',
  'residential', 'commercial', 'call now', 'book online',
];

const SERVICE_PAGE_INDICATORS = [
  '/service', '/services', '/what-we-do', '/our-services', '/offerings',
  '/plumbing', '/electrical', '/hvac', '/roofing', '/cleaning', '/repair',
];

const LOCATION_PAGE_INDICATORS = [
  '/location', '/locations', '/areas', '/service-area', '/coverage',
  '/near-', '/in-', '/serving-',
];

// ============================================================
// HTML FETCHING
// ============================================================

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string; status: number } | null> {
  try {
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NicoGEOBot/1.0; +https://nico.ai)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return {
      html,
      finalUrl: response.url,
      status: response.status,
    };
  } catch {
    return null;
  }
}

// ============================================================
// SIGNAL EXTRACTION
// ============================================================

function extractSignals(html: string, pageUrl: string): PageSignals {
  const signals: PageSignals = {
    url: pageUrl,
    title: '',
    metaDescription: '',
    h1Count: 0,
    h1Text: '',
    h2s: [],
    h3s: [],
    h4Count: 0,
    h5Count: 0,
    h6Count: 0,
    wordCount: 0,
    bodyText: '',
    internalLinks: [],
    internalLinkCount: 0,
    externalLinkCount: 0,
    anchorTexts: [],
    imageCount: 0,
    imagesWithAlt: 0,
    imagesMissingAlt: [],
    jsonLdTypes: [],
    hasLocalBusinessSchema: false,
    hasOrganizationSchema: false,
    hasServiceSchema: false,
    schemaDetails: [],
    hasGeoKeywords: false,
    hasServiceKeywords: false,
    geoTermsFound: [],
    serviceTermsFound: [],
    robotsNoindex: false,
    canonicalUrl: '',
    hasPhone: false,
    phoneNumbers: [],
    hasEmail: false,
    emails: [],
    hasAddress: false,
    addressSignals: [],
    napConsistent: true,
    isServicePage: false,
    isLocationPage: false,
  };

  let host = '';
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    // Invalid URL
  }

  // Detect page type
  const urlLower = pageUrl.toLowerCase();
  signals.isServicePage = SERVICE_PAGE_INDICATORS.some(ind => urlLower.includes(ind));
  signals.isLocationPage = LOCATION_PAGE_INDICATORS.some(ind => urlLower.includes(ind));

  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) signals.title = titleMatch[1].trim();

  // Meta description
  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  if (metaMatch) signals.metaDescription = metaMatch[1];

  // Robots noindex
  const robotsMatch = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i);
  if (robotsMatch && robotsMatch[1].toLowerCase().includes('noindex')) {
    signals.robotsNoindex = true;
  }

  // Canonical
  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (canonicalMatch) signals.canonicalUrl = canonicalMatch[1];

  // H1s
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let h1Match;
  while ((h1Match = h1Regex.exec(html)) !== null) {
    const text = h1Match[1].replace(/<[^>]+>/g, '').trim();
    if (text) {
      signals.h1Count++;
      if (!signals.h1Text) signals.h1Text = text;
    }
  }

  // H2s
  const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let h2Match;
  while ((h2Match = h2Regex.exec(html)) !== null) {
    const text = h2Match[1].replace(/<[^>]+>/g, '').trim();
    if (text) signals.h2s.push(text);
  }

  // H3s
  const h3Regex = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let h3Match;
  while ((h3Match = h3Regex.exec(html)) !== null) {
    const text = h3Match[1].replace(/<[^>]+>/g, '').trim();
    if (text) signals.h3s.push(text);
  }

  // H4-H6 counts
  signals.h4Count = (html.match(/<h4[^>]*>/gi) || []).length;
  signals.h5Count = (html.match(/<h5[^>]*>/gi) || []).length;
  signals.h6Count = (html.match(/<h6[^>]*>/gi) || []).length;

  // Images
  const imgRegex = /<img[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    signals.imageCount++;
    const imgTag = imgMatch[0];
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);

    if (altMatch && altMatch[1].trim()) {
      signals.imagesWithAlt++;
    } else {
      const src = srcMatch ? srcMatch[1] : 'unknown';
      signals.imagesMissingAlt.push(src.split('/').pop() || src);
    }
  }

  // Links
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const href = linkMatch[1];
    const anchorText = linkMatch[2].replace(/<[^>]+>/g, '').trim();

    if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
      if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../') || href.includes(host)) {
        signals.internalLinkCount++;
        // Normalize internal links
        let fullUrl = href;
        if (href.startsWith('/')) {
          try {
            fullUrl = new URL(href, pageUrl).href;
          } catch {
            fullUrl = href;
          }
        }
        if (!signals.internalLinks.includes(fullUrl) && signals.internalLinks.length < 50) {
          signals.internalLinks.push(fullUrl);
        }
      } else if (href.startsWith('http')) {
        signals.externalLinkCount++;
      }
    }

    if (anchorText && anchorText.length > 1 && anchorText.length < 100) {
      signals.anchorTexts.push(anchorText);
    }
  }

  // JSON-LD Schema
  const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    const content = jsonLdMatch[1];
    const contentLower = content.toLowerCase();

    // Extract @type values
    const typeRegex = /"@type"\s*:\s*"([^"]+)"/gi;
    let typeMatch;
    while ((typeMatch = typeRegex.exec(content)) !== null) {
      const schemaType = typeMatch[1];
      if (!signals.jsonLdTypes.includes(schemaType.toLowerCase())) {
        signals.jsonLdTypes.push(schemaType.toLowerCase());
      }
    }

    // Check for LocalBusiness variants
    if (contentLower.includes('localbusiness') ||
        contentLower.includes('plumber') ||
        contentLower.includes('electrician') ||
        contentLower.includes('hvacbusiness') ||
        contentLower.includes('homeandconstructionbusiness') ||
        contentLower.includes('professionalservice') ||
        contentLower.includes('localservice')) {
      signals.hasLocalBusinessSchema = true;
      signals.schemaDetails.push('LocalBusiness or variant detected');
    }

    // Check for Organization
    if (contentLower.includes('"organization"')) {
      signals.hasOrganizationSchema = true;
      signals.schemaDetails.push('Organization schema detected');
    }

    // Check for Service schema
    if (contentLower.includes('"service"') || contentLower.includes('"offer"') || contentLower.includes('"product"')) {
      signals.hasServiceSchema = true;
      signals.schemaDetails.push('Service/Offer schema detected');
    }
  }

  // Extract body text for analysis
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    const bodyHtml = bodyMatch[1];
    const cleanBody = bodyHtml
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    signals.bodyText = cleanBody;
    signals.wordCount = cleanBody.split(/\s+/).filter(w => w.length > 2).length;
  }

  // Check for geo keywords in key areas (title, H1, meta, H2s)
  const keyContent = (signals.title + ' ' + signals.h1Text + ' ' + signals.metaDescription + ' ' + signals.h2s.join(' ')).toLowerCase();
  const bodyLower = signals.bodyText.toLowerCase();

  // Check for specific city names
  for (const term of GEO_CITY_TERMS) {
    if (keyContent.includes(term.toLowerCase()) || bodyLower.includes(term.toLowerCase())) {
      if (!signals.geoTermsFound.includes(term)) {
        signals.geoTermsFound.push(term);
      }
    }
  }

  // Check for local intent phrases
  for (const term of GEO_INTENT_TERMS) {
    if (keyContent.includes(term.toLowerCase()) || bodyLower.includes(term.toLowerCase())) {
      if (!signals.geoTermsFound.includes(term)) {
        signals.geoTermsFound.push(term);
      }
    }
  }

  // hasGeoKeywords only true if city name found in KEY areas (not just body)
  const hasGeoInKeyContent = GEO_CITY_TERMS.some(term => keyContent.includes(term.toLowerCase()));
  signals.hasGeoKeywords = hasGeoInKeyContent;

  // Check for service industry terms
  for (const term of SERVICE_INDUSTRY_TERMS) {
    if (keyContent.includes(term.toLowerCase())) {
      if (!signals.serviceTermsFound.includes(term)) {
        signals.serviceTermsFound.push(term);
      }
    }
  }

  // Check for service intent terms
  for (const term of SERVICE_INTENT_TERMS) {
    if (keyContent.includes(term.toLowerCase()) || bodyLower.includes(term.toLowerCase())) {
      if (!signals.serviceTermsFound.includes(term)) {
        signals.serviceTermsFound.push(term);
      }
    }
  }

  // hasServiceKeywords only true if industry term found in KEY areas
  const hasServiceInKeyContent = SERVICE_INDUSTRY_TERMS.some(term => keyContent.includes(term.toLowerCase()));
  signals.hasServiceKeywords = hasServiceInKeyContent;

  // NAP Signals - Phone numbers
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}|(?:\+44|0)[\s]?[0-9]{2,5}[\s]?[0-9]{3,4}[\s]?[0-9]{3,4}/g;
  const phones = signals.bodyText.match(phoneRegex) || [];
  signals.phoneNumbers = [...new Set(phones)].slice(0, 5);
  signals.hasPhone = signals.phoneNumbers.length > 0;

  // NAP Signals - Emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = signals.bodyText.match(emailRegex) || [];
  signals.emails = [...new Set(emails)].filter(e => !e.includes('example.') && !e.includes('test.')).slice(0, 5);
  signals.hasEmail = signals.emails.length > 0;

  // NAP Signals - Address indicators
  const addressPatterns = [
    /\d+\s+[A-Za-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl)/gi,
    /[A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2}/g, // UK postcode
    /\d{5}(-\d{4})?/g, // US ZIP
  ];

  for (const pattern of addressPatterns) {
    const matches = signals.bodyText.match(pattern) || [];
    if (matches.length > 0) {
      signals.addressSignals.push(...matches.slice(0, 3));
      signals.hasAddress = true;
    }
  }

  return signals;
}

// ============================================================
// MULTI-PAGE CRAWLING
// ============================================================

async function crawlSite(homepageUrl: string): Promise<AuditContext> {
  // Fetch homepage
  const homepageResult = await fetchHtml(homepageUrl);
  if (!homepageResult) {
    throw new Error('Cannot fetch homepage');
  }

  const homepage = extractSignals(homepageResult.html, homepageResult.finalUrl);
  const crawledPages: PageSignals[] = [];

  // Find service and location pages to crawl
  const priorityLinks: string[] = [];
  const otherLinks: string[] = [];

  for (const link of homepage.internalLinks) {
    const linkLower = link.toLowerCase();
    const isServicePage = SERVICE_PAGE_INDICATORS.some(ind => linkLower.includes(ind));
    const isLocationPage = LOCATION_PAGE_INDICATORS.some(ind => linkLower.includes(ind));

    if (isServicePage || isLocationPage) {
      priorityLinks.push(link);
    } else if (!linkLower.includes('/blog') && !linkLower.includes('/news') &&
               !linkLower.includes('/privacy') && !linkLower.includes('/terms') &&
               !linkLower.includes('/cookie') && !linkLower.includes('/legal')) {
      otherLinks.push(link);
    }
  }

  // Crawl up to 3 additional pages (prioritize service/location pages)
  const pagesToCrawl = [...priorityLinks, ...otherLinks].slice(0, 3);

  for (const pageUrl of pagesToCrawl) {
    const result = await fetchHtml(pageUrl);
    if (result) {
      const signals = extractSignals(result.html, result.finalUrl);
      crawledPages.push(signals);
    }
  }

  return {
    homepage,
    crawledPages,
    allPages: [homepage, ...crawledPages],
  };
}

// ============================================================
// AUDIT RULES ENGINE
// ============================================================

function runAuditRules(ctx: AuditContext): Issue[] {
  const issues: Issue[] = [];
  const hp = ctx.homepage;

  // ============================================================
  // CRITICAL ISSUES
  // ============================================================

  // Robots noindex
  if (hp.robotsNoindex) {
    issues.push({
      title: 'Homepage Blocked from Indexing',
      priority: 'critical',
      evidence: 'Found <meta name="robots" content="noindex"> on homepage',
      impact: 'Your homepage is invisible to search engines and AI. Zero organic traffic possible.',
      recommendation: 'Remove the noindex directive immediately unless intentional.',
    });
  }

  // Missing or invalid title
  if (!hp.title || hp.title.length < 10) {
    issues.push({
      title: 'Missing or Invalid Page Title',
      priority: 'critical',
      evidence: hp.title ? `Title: "${hp.title}" (${hp.title.length} chars - too short)` : 'No <title> tag found',
      impact: 'Title is the #1 ranking factor. Without it, search engines cannot rank your page.',
      recommendation: 'Add a 50-60 character title: "[Service] in [City] | [Brand]"',
    });
  }

  // Missing H1
  if (hp.h1Count === 0) {
    issues.push({
      title: 'Missing H1 Heading',
      priority: 'critical',
      evidence: 'No <h1> tag found on homepage',
      impact: 'H1 tells AI what your page is about. Without it, AI cannot categorize or recommend you.',
      recommendation: 'Add one H1: "<h1>Professional [Service] in [City]</h1>"',
    });
  }

  // Multiple H1s
  if (hp.h1Count > 1) {
    issues.push({
      title: 'Multiple H1 Headings',
      priority: 'high',
      evidence: `Found ${hp.h1Count} H1 tags - should only have one`,
      impact: 'Multiple H1s dilute focus and confuse search engines about the primary topic.',
      recommendation: 'Keep only one H1 for the main topic. Convert others to H2s.',
    });
  }

  // H1 lacks geo + service modifiers (Opportunity - H1 exists but not optimized)
  if (hp.h1Text) {
    const h1Lower = hp.h1Text.toLowerCase();
    const h1HasGeo = GEO_CITY_TERMS.some(term => h1Lower.includes(term.toLowerCase()));
    const h1HasService = SERVICE_INDUSTRY_TERMS.some(term => h1Lower.includes(term.toLowerCase()));
    if (!h1HasGeo && !h1HasService) {
      issues.push({
        title: 'H1 Missing Geo & Service Keywords',
        priority: 'medium',
        evidence: `H1 text: "${hp.h1Text}" - lacks both location and service terms`,
        impact: 'Limits geo relevance for AI and local search.',
        recommendation: 'Include primary service + city in the H1: "Professional [Service] in [City]"',
      });
    } else if (!h1HasGeo || !h1HasService) {
      // Opportunity: H1 is partially optimized
      issues.push({
        title: 'H1 Could Be More Optimized',
        priority: 'low',
        evidence: `H1 text: "${hp.h1Text}"${!h1HasGeo ? ' - consider adding location' : ''}${!h1HasService ? ' - consider adding service keyword' : ''}`,
        impact: 'Adding both service and location to H1 maximizes local SEO impact.',
        recommendation: 'Strengthen H1 with both service type and city name.',
      });
    }
  }

  // Missing LocalBusiness schema
  if (!hp.hasLocalBusinessSchema && !hp.hasOrganizationSchema) {
    issues.push({
      title: 'Missing Business Schema Markup',
      priority: 'critical',
      evidence: hp.jsonLdTypes.length > 0
        ? `Found: ${hp.jsonLdTypes.join(', ')} - but no LocalBusiness/Organization`
        : 'No JSON-LD structured data found',
      impact: 'Schema tells AI exactly what your business does and where. Critical for local visibility.',
      recommendation: 'Add LocalBusiness JSON-LD with: name, address, phone, areaServed, openingHours.',
    });
  }

  // Missing Service schema
  if (!hp.hasServiceSchema && hp.hasLocalBusinessSchema) {
    issues.push({
      title: 'Missing Service Schema',
      priority: 'high',
      evidence: 'LocalBusiness found but no Service/Offer schema',
      impact: 'Service schema helps AI understand exactly what services you provide.',
      recommendation: 'Add Service schema for each main service with name, description, areaServed.',
    });
  }

  // Critically thin content
  if (hp.wordCount < 300) {
    issues.push({
      title: 'Critically Thin Homepage Content',
      priority: 'critical',
      evidence: `Only ${hp.wordCount} words on homepage (minimum: 500, recommended: 800+)`,
      impact: 'AI needs substantial content to understand your expertise. Thin pages rarely get cited.',
      recommendation: 'Expand to 800+ words: service descriptions, process, FAQs, service areas.',
    });
  } else if (hp.wordCount < 500) {
    issues.push({
      title: 'Limited Homepage Content',
      priority: 'high',
      evidence: `${hp.wordCount} words on homepage (recommended: 800+)`,
      impact: 'Comprehensive content outperforms thin pages in both search and AI citations.',
      recommendation: 'Add: detailed service breakdowns, FAQs, testimonials context, expertise proof.',
    });
  }

  // ============================================================
  // HIGH PRIORITY ISSUES
  // ============================================================

  // Missing or weak meta description
  if (!hp.metaDescription) {
    issues.push({
      title: 'Missing Meta Description',
      priority: 'high',
      evidence: 'No meta description found on homepage',
      impact: 'Meta description is your search result pitch. AI uses it to understand intent.',
      recommendation: 'Add 150-160 char description: "[Service] in [City]. [Value prop]. Call [phone]."',
    });
  } else if (hp.metaDescription.length < 100) {
    issues.push({
      title: 'Meta Description Too Short',
      priority: 'high',
      evidence: `Meta description is ${hp.metaDescription.length} chars (optimal: 150-160)`,
      impact: 'Short descriptions waste SERP real estate and miss keyword opportunities.',
      recommendation: 'Expand to 150-160 chars with service, location, and call-to-action.',
    });
  }

  // No geographic targeting in title
  const titleLower = hp.title.toLowerCase();
  const hasGeoInTitle = GEO_CITY_TERMS.some(term => titleLower.includes(term.toLowerCase()));
  if (hp.title && !hasGeoInTitle) {
    issues.push({
      title: 'Title Missing City/Location Modifier',
      priority: 'high',
      evidence: `Title "${hp.title}" has no location keywords`,
      impact: 'Local businesses must signal service area in title. AI cannot recommend for local queries.',
      recommendation: 'Add city to title: "Emergency Plumber in [City] | Company Name"',
    });
  }

  // No geo keywords anywhere
  if (!hp.hasGeoKeywords) {
    issues.push({
      title: 'No Geographic Targeting',
      priority: 'high',
      evidence: 'No location terms found in title, H1, meta, or H2s',
      impact: 'Local businesses must signal service area. AI cannot recommend without location context.',
      recommendation: 'Add city/area to title, H1, and throughout content. Create location pages.',
    });
  }

  // Missing contact info (both phone and email)
  if (!hp.hasPhone && !hp.hasEmail) {
    issues.push({
      title: 'No Contact Information Visible',
      priority: 'high',
      evidence: 'No phone number or email detected on homepage',
      impact: 'Contact info is essential for local SEO and trust. AI may not recommend without it.',
      recommendation: 'Add phone and email prominently in header, footer, and contact section.',
    });
  }

  // Missing phone specifically (important for local businesses)
  if (!hp.hasPhone && hp.hasEmail) {
    issues.push({
      title: 'No Phone Number Visible',
      priority: 'medium',
      evidence: `Email found (${hp.emails[0]}) but no phone number detected`,
      impact: 'Phone numbers are critical for local SEO and immediate customer contact.',
      recommendation: 'Add a clickable phone number in header and footer.',
    });
  }

  // Missing email specifically
  if (hp.hasPhone && !hp.hasEmail) {
    issues.push({
      title: 'No Email Address Visible',
      priority: 'low',
      evidence: `Phone found (${hp.phoneNumbers[0]}) but no email detected`,
      impact: 'Some customers prefer email contact. Offering multiple options increases leads.',
      recommendation: 'Add a professional email address to your contact section.',
    });
  }

  // Insufficient internal links
  if (hp.internalLinkCount < 10) {
    issues.push({
      title: 'Insufficient Internal Linking',
      priority: 'high',
      evidence: `Only ${hp.internalLinkCount} internal links (recommended: 10+)`,
      impact: 'Internal links help search engines discover content and distribute authority.',
      recommendation: 'Add links to: all services, location pages, about, contact, FAQs.',
    });
  }

  // No service keywords on homepage
  if (!hp.hasServiceKeywords) {
    issues.push({
      title: 'No Service Keywords on Homepage',
      priority: 'high',
      evidence: 'No clear service terms found in title, H1, H2s, or meta',
      impact: 'AI needs to understand what services you offer to recommend you.',
      recommendation: 'Include specific services in headings: "Emergency Plumbing", "Drain Cleaning", etc.',
    });
  }

  // ============================================================
  // MEDIUM PRIORITY ISSUES
  // ============================================================

  // Images missing alt text
  if (hp.imageCount > 0) {
    const missingAltCount = hp.imageCount - hp.imagesWithAlt;
    const altCoverage = Math.round((hp.imagesWithAlt / hp.imageCount) * 100);

    if (missingAltCount > 0) {
      issues.push({
        title: 'Images Missing Alt Text',
        priority: missingAltCount > 5 ? 'high' : 'medium',
        evidence: `${missingAltCount} of ${hp.imageCount} images lack alt text (${altCoverage}% coverage). Missing: ${hp.imagesMissingAlt.slice(0, 3).join(', ')}${hp.imagesMissingAlt.length > 3 ? '...' : ''}`,
        impact: 'Alt text helps AI understand images and improves accessibility. Missing alts hurt rankings.',
        recommendation: 'Add descriptive alt text to all images: alt="[Service] technician in [City]"',
      });
    }
  }

  // No images at all (visual content helps engagement)
  if (hp.imageCount === 0 && hp.wordCount > 200) {
    issues.push({
      title: 'No Images on Homepage',
      priority: 'medium',
      evidence: 'Homepage has no <img> tags detected',
      impact: 'Visual content increases engagement and helps users understand your services.',
      recommendation: 'Add relevant images: team photos, service examples, before/after shots, trust badges.',
    });
  }

  // Flat heading structure
  if (hp.h1Count > 0 && hp.h2s.length === 0) {
    issues.push({
      title: 'Flat Heading Structure',
      priority: 'medium',
      evidence: `Found H1 but no H2 subheadings (${hp.h3s.length} H3s found)`,
      impact: 'H1→H2→H3 hierarchy helps AI parse sections and extract answers.',
      recommendation: 'Add H2s for: Services, About Us, Service Areas, FAQs, Contact.',
    });
  }

  // Repetitive anchor text
  const anchorCounts = new Map<string, number>();
  hp.anchorTexts.forEach(t => {
    const lower = t.toLowerCase().trim();
    if (lower.length > 2) {
      anchorCounts.set(lower, (anchorCounts.get(lower) || 0) + 1);
    }
  });
  const duplicateAnchors = [...anchorCounts.entries()].filter(([_, count]) => count > 3);
  if (duplicateAnchors.length > 0) {
    issues.push({
      title: 'Repetitive Anchor Text',
      priority: 'medium',
      evidence: `Overused: ${duplicateAnchors.slice(0, 3).map(([t, c]) => `"${t}" (${c}x)`).join(', ')}`,
      impact: 'Repetitive anchors look spammy and waste descriptive link opportunities.',
      recommendation: 'Vary anchor text: "plumbing services", "our drain cleaning", "emergency repairs".',
    });
  }

  // Missing canonical
  if (!hp.canonicalUrl) {
    issues.push({
      title: 'Missing Canonical Tag',
      priority: 'medium',
      evidence: 'No <link rel="canonical"> found on homepage',
      impact: 'Canonical tags prevent duplicate content issues and consolidate ranking signals.',
      recommendation: 'Add <link rel="canonical" href="https://yourdomain.com/"> to <head>.',
    });
  }

  // NAP consistency check across pages
  if (ctx.crawledPages.length > 0) {
    const homepagePhone = hp.phoneNumbers[0];
    const inconsistentNAP = ctx.crawledPages.some(page =>
      page.hasPhone && page.phoneNumbers[0] && page.phoneNumbers[0] !== homepagePhone
    );
    if (inconsistentNAP) {
      issues.push({
        title: 'Inconsistent NAP Information',
        priority: 'medium',
        evidence: 'Different phone numbers found across pages',
        impact: 'Inconsistent Name, Address, Phone confuses search engines and hurts local rankings.',
        recommendation: 'Ensure identical NAP on every page. Use schema markup consistently.',
      });
    }
  }

  // Thin service/location pages
  for (const page of ctx.crawledPages) {
    if ((page.isServicePage || page.isLocationPage) && page.wordCount < 300) {
      issues.push({
        title: `Thin ${page.isServicePage ? 'Service' : 'Location'} Page`,
        priority: 'medium',
        evidence: `${page.url.split('/').pop() || page.url} has only ${page.wordCount} words`,
        impact: 'Service and location pages need depth to rank. Thin pages get ignored.',
        recommendation: 'Expand to 500+ words: service details, process, pricing, FAQs, testimonials.',
      });
    }
  }

  // ============================================================
  // LOW PRIORITY ISSUES
  // ============================================================

  // Title length optimization
  if (hp.title && (hp.title.length < 30 || hp.title.length > 65)) {
    issues.push({
      title: 'Suboptimal Title Length',
      priority: 'low',
      evidence: `Title is ${hp.title.length} chars (optimal: 50-60)`,
      impact: 'Short titles underuse space. Long titles get truncated in search results.',
      recommendation: 'Adjust to 50-60 characters for full display.',
    });
  }

  // Meta description length
  if (hp.metaDescription && hp.metaDescription.length > 160) {
    issues.push({
      title: 'Meta Description Too Long',
      priority: 'low',
      evidence: `Meta description is ${hp.metaDescription.length} chars (will be truncated at ~160)`,
      impact: 'Truncated descriptions may cut off your call-to-action.',
      recommendation: 'Trim to 150-160 characters, ending with CTA.',
    });
  }

  // Few H2 subheadings
  if (hp.h2s.length > 0 && hp.h2s.length < 4 && hp.wordCount > 500) {
    issues.push({
      title: 'Limited Subheadings',
      priority: 'low',
      evidence: `Only ${hp.h2s.length} H2s for ${hp.wordCount} words of content`,
      impact: 'More subheadings improve scannability and help AI extract sections.',
      recommendation: 'Add H2 every 200-300 words for major sections.',
    });
  }

  // Missing address with LocalBusiness
  if (hp.hasLocalBusinessSchema && !hp.hasAddress) {
    issues.push({
      title: 'No Physical Address Displayed',
      priority: 'low',
      evidence: 'LocalBusiness schema found but no street address visible on page',
      impact: 'Physical address reinforces local relevance for both users and search engines.',
      recommendation: 'Display full address in footer and contact section.',
    });
  }

  // Pages missing H1
  for (const page of ctx.crawledPages) {
    if (page.h1Count === 0) {
      issues.push({
        title: `Crawled Page Missing H1`,
        priority: 'medium',
        evidence: `${page.url.split('/').pop() || page.url} has no H1 heading`,
        impact: 'Every page needs an H1 to tell search engines its topic.',
        recommendation: 'Add descriptive H1 to each page.',
      });
    }
  }

  // ============================================================
  // ADDITIONAL CHECKS (ensure 10+ issues for most sites)
  // ============================================================

  // Check for FAQ schema (important for AI visibility - fire for any site)
  const hasFAQSchema = hp.jsonLdTypes.some(t => t.toLowerCase().includes('faq'));
  if (!hasFAQSchema) {
    issues.push({
      title: 'Missing FAQ Schema',
      priority: 'medium',
      evidence: `No FAQPage schema found. Schema types present: ${hp.jsonLdTypes.length > 0 ? hp.jsonLdTypes.join(', ') : 'none'}`,
      impact: 'FAQ schema helps AI extract and cite your answers directly in search results.',
      recommendation: 'Add FAQPage schema for common questions about your services.',
    });
  }

  // Check for breadcrumb schema (important for any site with multiple pages)
  const hasBreadcrumbSchema = hp.jsonLdTypes.some(t => t.toLowerCase().includes('breadcrumb'));
  if (!hasBreadcrumbSchema) {
    issues.push({
      title: 'Missing Breadcrumb Schema',
      priority: 'low',
      evidence: 'No BreadcrumbList schema detected on homepage',
      impact: 'Breadcrumb schema improves site structure understanding and search appearance.',
      recommendation: 'Add BreadcrumbList schema to all pages showing navigation hierarchy.',
    });
  }

  // Check external link count (too few = isolated, too many = link leakage)
  if (hp.externalLinkCount === 0) {
    issues.push({
      title: 'No External Links',
      priority: 'low',
      evidence: 'Homepage has 0 external links to authoritative sources',
      impact: 'Linking to relevant authorities shows AI you connect to the broader web.',
      recommendation: 'Add 2-5 links to industry associations, certifications, or trusted resources.',
    });
  }

  // Check heading hierarchy (H2 without H1, or H3 without H2)
  if (hp.h1Count === 0 && hp.h2s.length > 0) {
    issues.push({
      title: 'Broken Heading Hierarchy',
      priority: 'medium',
      evidence: `Found ${hp.h2s.length} H2s but no H1 - heading structure is broken`,
      impact: 'Headings must follow H1→H2→H3 order for AI to parse content correctly.',
      recommendation: 'Add an H1 before your H2 headings.',
    });
  }

  // Check for social proof signals
  const bodyLower = hp.bodyText.toLowerCase();
  const hasSocialProof = bodyLower.includes('review') || bodyLower.includes('testimonial') ||
                         bodyLower.includes('rating') || bodyLower.includes('customer') ||
                         bodyLower.includes('client');
  if (!hasSocialProof && hp.wordCount > 200) {
    issues.push({
      title: 'No Social Proof Detected',
      priority: 'medium',
      evidence: 'No mentions of reviews, testimonials, ratings, or customer feedback found',
      impact: 'Social proof signals trust. AI assistants favor businesses with visible reviews.',
      recommendation: 'Add a testimonials section or link to Google/Yelp reviews.',
    });
  }

  // Check for service area specificity (fire for any local business site)
  if (hp.geoTermsFound.length > 0 && hp.geoTermsFound.length < 3) {
    issues.push({
      title: 'Limited Service Area Coverage',
      priority: 'medium',
      evidence: `Only ${hp.geoTermsFound.length} location terms found: ${hp.geoTermsFound.join(', ')}`,
      impact: 'Mentioning more specific areas helps AI recommend you for hyper-local queries.',
      recommendation: 'Add neighborhoods, districts, and nearby towns you serve.',
    });
  }

  // Check for no geo terms at all (different from above - total absence)
  if (hp.geoTermsFound.length === 0) {
    issues.push({
      title: 'No Service Area Mentioned',
      priority: 'high',
      evidence: 'No city names, neighborhoods, or location phrases found anywhere on page',
      impact: 'Without any location mentions, AI cannot determine where you operate.',
      recommendation: 'Add your primary city to title, H1, meta description, and body content.',
    });
  }

  // Check page load signals (large image count)
  if (hp.imageCount > 20) {
    issues.push({
      title: 'High Image Count',
      priority: 'low',
      evidence: `${hp.imageCount} images on homepage may impact load speed`,
      impact: 'Too many images slow page load, hurting rankings and user experience.',
      recommendation: 'Optimize images, use lazy loading, and consider removing non-essential images.',
    });
  }

  // Check for pricing/cost signals (important for any business site)
  const hasPricingSignals = bodyLower.includes('price') || bodyLower.includes('cost') ||
                            bodyLower.includes('quote') || bodyLower.includes('estimate') ||
                            bodyLower.includes('£') || bodyLower.includes('$') ||
                            bodyLower.includes('free') || bodyLower.includes('rate');
  if (!hasPricingSignals && hp.wordCount > 200) {
    issues.push({
      title: 'No Pricing Information',
      priority: 'medium',
      evidence: 'No pricing, cost, quote, or rate-related terms found on homepage',
      impact: 'Users and AI want to understand pricing. Missing info reduces conversion.',
      recommendation: 'Add pricing ranges, "free estimate" messaging, or "call for quote" CTAs.',
    });
  }

  // Check for call-to-action presence
  const hasCTA = bodyLower.includes('call us') || bodyLower.includes('contact us') ||
                 bodyLower.includes('get a quote') || bodyLower.includes('book') ||
                 bodyLower.includes('schedule') || bodyLower.includes('request');
  if (!hasCTA) {
    issues.push({
      title: 'Weak Call-to-Action',
      priority: 'medium',
      evidence: 'No clear call-to-action phrases detected on homepage',
      impact: 'Without CTAs, visitors don\'t know what action to take next.',
      recommendation: 'Add prominent CTAs: "Call Now", "Get Free Quote", "Book Online".',
    });
  }

  // Check meta description contains service + location
  if (hp.metaDescription) {
    const metaLower = hp.metaDescription.toLowerCase();
    const metaHasService = SERVICE_INDUSTRY_TERMS.some(t => metaLower.includes(t.toLowerCase()));
    const metaHasGeo = GEO_CITY_TERMS.some(t => metaLower.includes(t.toLowerCase()));

    if (!metaHasService || !metaHasGeo) {
      issues.push({
        title: 'Meta Description Missing Key Terms',
        priority: 'medium',
        evidence: `Meta description ${!metaHasService ? 'lacks service keywords' : ''}${!metaHasService && !metaHasGeo ? ' and ' : ''}${!metaHasGeo ? 'lacks location terms' : ''}`,
        impact: 'Meta descriptions should include your service and location for local SEO.',
        recommendation: 'Rewrite: "[Service] in [City]. [Unique value]. Call [phone]."',
      });
    }
  }

  // ============================================================
  // UNIVERSAL RULES (fire for almost any site)
  // ============================================================

  // Check for Review/AggregateRating schema (most sites lack this)
  const hasReviewSchema = hp.jsonLdTypes.some(t =>
    t.toLowerCase().includes('review') || t.toLowerCase().includes('aggregaterating')
  );
  if (!hasReviewSchema) {
    issues.push({
      title: 'Missing Review Schema',
      priority: 'medium',
      evidence: `No Review or AggregateRating schema found. Current schemas: ${hp.jsonLdTypes.length > 0 ? hp.jsonLdTypes.join(', ') : 'none'}`,
      impact: 'Review schema enables star ratings in search results, increasing click-through rates by up to 35%.',
      recommendation: 'Add AggregateRating schema with your Google/Yelp review data.',
    });
  }

  // Check title includes brand/business name
  const titleWords = hp.title.split(/[\s|–\-:]+/).filter(w => w.length > 2);
  if (hp.title && titleWords.length < 3) {
    issues.push({
      title: 'Title Too Simple',
      priority: 'medium',
      evidence: `Title "${hp.title}" has only ${titleWords.length} meaningful words`,
      impact: 'Titles should include service, location, and brand for maximum SEO impact.',
      recommendation: 'Use format: "[Primary Service] in [City] | [Brand Name]"',
    });
  }

  // Check for complete meta tags (title + description)
  if (hp.title && !hp.metaDescription) {
    issues.push({
      title: 'Incomplete Social Meta Tags',
      priority: 'low',
      evidence: 'Missing meta description which affects Open Graph sharing',
      impact: 'Social sharing without proper meta tags looks unprofessional and reduces engagement.',
      recommendation: 'Add meta description and Open Graph tags (og:title, og:description, og:image).',
    });
  }

  // Check H2 content quality
  if (hp.h2s.length > 0) {
    const shortH2s = hp.h2s.filter(h => h.length < 20);
    if (shortH2s.length > hp.h2s.length / 2) {
      issues.push({
        title: 'Weak Subheading Content',
        priority: 'low',
        evidence: `${shortH2s.length} of ${hp.h2s.length} H2s are very short: "${shortH2s.slice(0, 2).join('", "')}"`,
        impact: 'Descriptive H2s help AI understand page sections and improve featured snippet chances.',
        recommendation: 'Make H2s descriptive: "Why Choose Our [Service] in [City]" instead of just "Services".',
      });
    }
  }

  // Check content depth (even if not "thin")
  if (hp.wordCount >= 300 && hp.wordCount < 800) {
    issues.push({
      title: 'Content Could Be More Comprehensive',
      priority: 'low',
      evidence: `Homepage has ${hp.wordCount} words. Competitive pages average 1000-1500 words.`,
      impact: 'More comprehensive content tends to rank better and gets more AI citations.',
      recommendation: 'Consider adding: detailed service explanations, process steps, FAQs, case studies.',
    });
  }

  // Check for mobile-specific signals in anchor text
  const clickHereAnchors = hp.anchorTexts.filter(a =>
    a.toLowerCase().includes('click here') || a.toLowerCase().includes('read more') || a.toLowerCase() === 'here'
  );
  if (clickHereAnchors.length > 2) {
    issues.push({
      title: 'Poor Anchor Text Quality',
      priority: 'medium',
      evidence: `Found ${clickHereAnchors.length} generic anchors like "click here" or "read more"`,
      impact: 'Descriptive anchor text helps search engines understand linked content.',
      recommendation: 'Replace generic anchors with descriptive text: "our plumbing services" instead of "click here".',
    });
  }

  // Check for structured content signals (lists, tables)
  const hasStructuredContent = hp.bodyText.includes('•') || hp.bodyText.includes('✓') ||
                               hp.bodyText.includes('1.') || hp.bodyText.includes('Step');
  if (!hasStructuredContent && hp.wordCount > 400) {
    issues.push({
      title: 'Lacks Structured Content',
      priority: 'low',
      evidence: 'No bullet points, numbered lists, or step-by-step content detected',
      impact: 'Structured content is easier to scan and more likely to be featured in AI responses.',
      recommendation: 'Add bulleted service lists, numbered process steps, or comparison tables.',
    });
  }

  // Universal: Check if title and H1 match (indicates good focus)
  if (hp.title && hp.h1Text) {
    const titleCore = hp.title.toLowerCase().split('|')[0].trim();
    const h1Core = hp.h1Text.toLowerCase().trim();
    const similarity = titleCore.includes(h1Core.slice(0, 20)) || h1Core.includes(titleCore.slice(0, 20));
    if (!similarity && titleCore.length > 10 && h1Core.length > 10) {
      issues.push({
        title: 'Title and H1 Mismatch',
        priority: 'low',
        evidence: `Title: "${hp.title.slice(0, 50)}..." vs H1: "${hp.h1Text.slice(0, 50)}..."`,
        impact: 'Mismatched title and H1 can confuse search engines about page focus.',
        recommendation: 'Align your H1 with your title tag for consistent messaging.',
      });
    }
  }

  // Check for years/dates in content (freshness signal)
  const currentYear = new Date().getFullYear();
  const hasCurrentYear = hp.bodyText.includes(String(currentYear));
  const hasLastYear = hp.bodyText.includes(String(currentYear - 1));
  if (!hasCurrentYear && !hasLastYear && hp.wordCount > 300) {
    issues.push({
      title: 'No Freshness Signals',
      priority: 'low',
      evidence: `No mention of ${currentYear} or ${currentYear - 1} found in content`,
      impact: 'Date references signal content freshness to search engines and AI.',
      recommendation: `Add current year to content: "Serving [City] since 2010" or "Updated for ${currentYear}"`,
    });
  }

  // Check for trust signals
  const trustTerms = ['guarantee', 'warranty', 'satisfaction', 'money back', 'years experience', 'established'];
  const hasTrustSignals = trustTerms.some(term => hp.bodyText.toLowerCase().includes(term));
  if (!hasTrustSignals && hp.wordCount > 200) {
    issues.push({
      title: 'Missing Trust Signals',
      priority: 'medium',
      evidence: 'No guarantee, warranty, or experience claims found in content',
      impact: 'Trust signals influence both user decisions and AI recommendations.',
      recommendation: 'Add trust elements: years in business, satisfaction guarantee, certifications.',
    });
  }

  // Ensure minimum issue count for meaningful audit
  // If very few issues found, add general optimization suggestions
  if (issues.length < 5) {
    // Check if site seems well-optimized but missing GEO focus
    if (!hp.hasGeoKeywords) {
      issues.push({
        title: 'Site Lacks Local SEO Focus',
        priority: 'high',
        evidence: 'No city or location names found in title, H1, or meta description',
        impact: 'Without location signals, your site cannot compete for local search queries.',
        recommendation: 'Add your primary service city to title, H1, and throughout content.',
      });
    }

    if (!hp.hasLocalBusinessSchema && !hp.hasOrganizationSchema) {
      issues.push({
        title: 'No Business Identity Schema',
        priority: 'high',
        evidence: 'Site lacks structured data identifying it as a business entity',
        impact: 'Search engines and AI cannot properly categorize your business without schema.',
        recommendation: 'Implement LocalBusiness or Organization JSON-LD schema.',
      });
    }
  }

  // ============================================================
  // OPPORTUNITY CHECKS (weak-but-passing signals)
  // ============================================================

  // Opportunity: Schema exists but missing serviceArea/areaServed
  if (hp.hasLocalBusinessSchema || hp.hasOrganizationSchema) {
    const schemaStr = hp.schemaDetails.join(' ').toLowerCase();
    const hasAreaServed = schemaStr.includes('areaserved') || schemaStr.includes('servicearea') || schemaStr.includes('geo');
    if (!hasAreaServed) {
      issues.push({
        title: 'Schema Missing Service Area',
        priority: 'medium',
        evidence: `Business schema found but no areaServed/serviceArea property detected`,
        impact: 'Adding areaServed helps AI understand your geographic coverage.',
        recommendation: 'Add areaServed property to your LocalBusiness schema with cities/regions you serve.',
      });
    }
  }

  // Opportunity: Title exists but structure could be better
  if (hp.title && hp.title.length >= 10) {
    const hasDelimiter = hp.title.includes('|') || hp.title.includes('-') || hp.title.includes('–');
    const titleHasService = SERVICE_INDUSTRY_TERMS.some(t => hp.title.toLowerCase().includes(t.toLowerCase()));
    if (!hasDelimiter && hp.title.length < 50) {
      issues.push({
        title: 'Title Structure Could Be Improved',
        priority: 'low',
        evidence: `Title "${hp.title}" lacks standard SEO structure (service | location | brand)`,
        impact: 'Well-structured titles perform better in search results.',
        recommendation: 'Use format: "Primary Service in City | Brand Name" with pipe or dash separator.',
      });
    }
    if (hasDelimiter && !titleHasService && hasGeoInTitle) {
      issues.push({
        title: 'Title Could Include Service Type',
        priority: 'low',
        evidence: `Title has location but no specific service keyword`,
        impact: 'Including service type in title improves relevance for service queries.',
        recommendation: 'Add your primary service to the title before the location.',
      });
    }
  }

  // Opportunity: Meta description adequate (100-140) but not optimal (150-160)
  if (hp.metaDescription && hp.metaDescription.length >= 100 && hp.metaDescription.length < 140) {
    issues.push({
      title: 'Meta Description Could Be Longer',
      priority: 'low',
      evidence: `Meta description is ${hp.metaDescription.length} chars (optimal: 150-160)`,
      impact: 'Longer descriptions provide more context and keyword opportunities.',
      recommendation: 'Expand to 150-160 chars to maximize SERP real estate.',
    });
  }

  // Opportunity: Content adequate (500-800) but below competitive threshold (1000+)
  if (hp.wordCount >= 500 && hp.wordCount < 800) {
    issues.push({
      title: 'Content Depth Opportunity',
      priority: 'low',
      evidence: `Homepage has ${hp.wordCount} words - adequate but below competitive threshold`,
      impact: 'Top-ranking pages often have 1000+ words of quality content.',
      recommendation: 'Consider adding: detailed FAQs, service process explanation, or case studies.',
    });
  }

  // Opportunity: Content good (800-1000) but could be more comprehensive
  if (hp.wordCount >= 800 && hp.wordCount < 1000) {
    issues.push({
      title: 'Content Nearly Optimal',
      priority: 'low',
      evidence: `Homepage has ${hp.wordCount} words - good, but competitive pages average 1000-1500`,
      impact: 'A bit more content could help you outrank competitors.',
      recommendation: 'Add 200-400 more words covering FAQs, testimonial context, or service details.',
    });
  }

  // Opportunity: Internal links exist (10+) but many have generic anchors
  if (hp.internalLinkCount >= 10) {
    const genericAnchors = hp.anchorTexts.filter(a => {
      const lower = a.toLowerCase().trim();
      return lower === 'learn more' || lower === 'read more' || lower === 'click here' ||
             lower === 'here' || lower === 'more' || lower === 'view' || lower === 'see more' ||
             lower.length < 3;
    });
    const genericRatio = genericAnchors.length / hp.anchorTexts.length;
    if (genericRatio > 0.2 && genericAnchors.length > 3) {
      issues.push({
        title: 'Internal Link Anchors Could Be More Descriptive',
        priority: 'medium',
        evidence: `${genericAnchors.length} of ${hp.anchorTexts.length} link anchors are generic ("learn more", "click here", etc.)`,
        impact: 'Descriptive anchors help search engines understand linked content better.',
        recommendation: 'Replace generic anchors with descriptive text like "our plumbing services" or "drain cleaning in [City]".',
      });
    }
  }

  // Opportunity: Has phone but not in clickable tel: format (check body for tel:)
  if (hp.hasPhone) {
    const hasTelLink = hp.bodyText.includes('tel:') || hp.bodyText.includes('href="tel');
    if (!hasTelLink) {
      issues.push({
        title: 'Phone Number May Not Be Clickable',
        priority: 'low',
        evidence: `Phone number found but no tel: link detected in HTML`,
        impact: 'Mobile users expect tap-to-call functionality.',
        recommendation: 'Wrap phone numbers in clickable tel: links: <a href="tel:+1234567890">',
      });
    }
  }

  // Opportunity: Has some H2s but none contain geo terms
  if (hp.h2s.length >= 2) {
    const h2sWithGeo = hp.h2s.filter(h2 =>
      GEO_CITY_TERMS.some(term => h2.toLowerCase().includes(term.toLowerCase()))
    );
    if (h2sWithGeo.length === 0) {
      issues.push({
        title: 'Subheadings Could Include Location',
        priority: 'low',
        evidence: `${hp.h2s.length} H2 subheadings found, but none mention your service area`,
        impact: 'Location in subheadings reinforces local relevance.',
        recommendation: 'Add location to at least one H2: "Our Services in [City]" or "Why [City] Trusts Us".',
      });
    }
  }

  // Opportunity: Images have alt text but none are geo-optimized
  if (hp.imagesWithAlt > 0) {
    // This is a general opportunity since we can't easily check alt text content
    issues.push({
      title: 'Image Alt Text Optimization',
      priority: 'low',
      evidence: `${hp.imagesWithAlt} images have alt text - verify they include service/location keywords`,
      impact: 'Geo-optimized alt text helps with image search and reinforces local relevance.',
      recommendation: 'Use descriptive alts like "plumber fixing sink in [City]" instead of generic "plumber at work".',
    });
  }

  return issues;
}

// ============================================================
// SCORING
// ============================================================

function calculateScore(issues: Issue[]): number {
  let score = 100;

  for (const issue of issues) {
    score -= WEIGHTS[issue.priority] || 0;
  }

  // Ensure score stays within 0-100
  return Math.max(0, Math.min(100, score));
}

// ============================================================
// MAIN AUDIT FUNCTION
// ============================================================

async function runAudit(siteUrl: string): Promise<AuditResponse> {
  // Normalize URL
  if (!siteUrl.startsWith('http')) {
    siteUrl = 'https://' + siteUrl;
  }

  // Crawl the site
  const ctx = await crawlSite(siteUrl);

  // Run audit rules
  const allIssues = runAuditRules(ctx);

  // Calculate score
  const score = calculateScore(allIssues);

  // Sort by priority for top issues
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedIssues = [...allIssues].sort((a, b) =>
    priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  // Build response
  return {
    siteUrl: ctx.homepage.url,
    score,
    topIssues: sortedIssues.slice(0, 3),
    issuesByPriority: {
      critical: allIssues.filter(i => i.priority === 'critical'),
      high: allIssues.filter(i => i.priority === 'high'),
      medium: allIssues.filter(i => i.priority === 'medium'),
      low: allIssues.filter(i => i.priority === 'low'),
    },
  };
}

// ============================================================
// HTML REPORT UI
// ============================================================

const HTML_UI = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GEO Audit - AI Search Visibility Analysis</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --card-hover: #273449;
      --border: #334155;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --critical: #ef4444;
      --critical-bg: rgba(239, 68, 68, 0.1);
      --high: #f59e0b;
      --high-bg: rgba(245, 158, 11, 0.1);
      --medium: #3b82f6;
      --medium-bg: rgba(59, 130, 246, 0.1);
      --low: #64748b;
      --low-bg: rgba(100, 116, 139, 0.1);
      --success: #10b981;
      --success-bg: rgba(16, 185, 129, 0.1);
      --purple: #8b5cf6;
      --purple-bg: rgba(139, 92, 246, 0.1);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.6;
    }

    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: 3rem 1.5rem;
    }

    header {
      text-align: center;
      margin-bottom: 3rem;
    }

    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, var(--purple), var(--critical));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .tagline {
      color: var(--text-muted);
      font-size: 1.125rem;
    }

    .input-section {
      display: flex;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    input[type="url"] {
      flex: 1;
      padding: 1rem 1.25rem;
      font-size: 1rem;
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 0.75rem;
      color: var(--text);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    input[type="url"]:focus {
      border-color: var(--purple);
      box-shadow: 0 0 0 3px var(--purple-bg);
    }

    input[type="url"]::placeholder {
      color: var(--text-muted);
    }

    button {
      padding: 1rem 2rem;
      font-size: 1rem;
      font-weight: 600;
      background: linear-gradient(135deg, var(--purple), #6366f1);
      border: none;
      border-radius: 0.75rem;
      color: white;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    button:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(139, 92, 246, 0.3);
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .status {
      text-align: center;
      padding: 1.5rem;
      color: var(--text-muted);
      font-size: 1rem;
    }

    .status.error {
      color: var(--critical);
      background: var(--critical-bg);
      border-radius: 0.75rem;
    }

    .results {
      display: none;
    }

    .results.visible {
      display: block;
    }

    .score-card {
      display: flex;
      align-items: center;
      gap: 2rem;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 2rem;
      margin-bottom: 2rem;
    }

    .score-dial {
      position: relative;
      width: 160px;
      height: 160px;
      flex-shrink: 0;
    }

    .score-dial svg {
      transform: rotate(-90deg);
    }

    .dial-track {
      fill: none;
      stroke: var(--border);
      stroke-width: 12;
    }

    .dial-progress {
      fill: none;
      stroke-width: 12;
      stroke-linecap: round;
      transition: stroke-dashoffset 1s ease-out, stroke 0.3s;
    }

    .score-value {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .score-number {
      font-size: 3rem;
      font-weight: 700;
      line-height: 1;
    }

    .score-label {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }

    .score-info h2 {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }

    .score-url {
      color: var(--text-muted);
      font-size: 0.875rem;
      word-break: break-all;
      margin-bottom: 0.75rem;
    }

    .score-badge {
      display: inline-block;
      padding: 0.375rem 1rem;
      border-radius: 2rem;
      font-size: 0.875rem;
      font-weight: 600;
    }

    .badge-good { background: var(--success-bg); color: var(--success); }
    .badge-warn { background: var(--high-bg); color: var(--high); }
    .badge-bad { background: var(--critical-bg); color: var(--critical); }

    .section {
      margin-bottom: 2rem;
    }

    .section-header {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .issue-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.5rem;
      margin-bottom: 1rem;
      border-left: 4px solid;
      transition: background-color 0.2s;
    }

    .issue-card:hover {
      background: var(--card-hover);
    }

    .issue-card.critical { border-left-color: var(--critical); }
    .issue-card.high { border-left-color: var(--high); }
    .issue-card.medium { border-left-color: var(--medium); }
    .issue-card.low { border-left-color: var(--low); }

    .issue-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 0.75rem;
    }

    .issue-title {
      font-size: 1.125rem;
      font-weight: 600;
    }

    .priority-tag {
      padding: 0.25rem 0.75rem;
      border-radius: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      flex-shrink: 0;
    }

    .priority-tag.critical { background: var(--critical-bg); color: var(--critical); }
    .priority-tag.high { background: var(--high-bg); color: var(--high); }
    .priority-tag.medium { background: var(--medium-bg); color: var(--medium); }
    .priority-tag.low { background: var(--low-bg); color: var(--low); }

    .issue-impact {
      color: var(--text-muted);
      margin-bottom: 1rem;
      line-height: 1.5;
    }

    .issue-evidence {
      background: rgba(0, 0, 0, 0.25);
      padding: 1rem;
      border-radius: 0.5rem;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 0.875rem;
      margin-bottom: 1rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .issue-fix {
      background: var(--success-bg);
      border: 1px solid rgba(16, 185, 129, 0.2);
      padding: 1rem;
      border-radius: 0.5rem;
      font-size: 0.9375rem;
    }

    .issue-fix strong {
      color: var(--success);
    }

    details {
      margin-bottom: 1rem;
    }

    summary {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1rem 1.25rem;
      cursor: pointer;
      list-style: none;
      transition: background-color 0.2s;
    }

    summary::-webkit-details-marker { display: none; }

    summary:hover {
      background: var(--card-hover);
    }

    summary h3 {
      font-size: 1rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .count-badge {
      background: var(--border);
      padding: 0.125rem 0.625rem;
      border-radius: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .chevron {
      transition: transform 0.2s;
    }

    details[open] .chevron {
      transform: rotate(180deg);
    }

    details[open] summary {
      border-radius: 0.75rem 0.75rem 0 0;
      border-bottom: none;
    }

    .details-content {
      padding: 1rem;
      background: var(--card);
      border: 1px solid var(--border);
      border-top: none;
      border-radius: 0 0 0.75rem 0.75rem;
    }

    .details-content .issue-card:last-child {
      margin-bottom: 0;
    }

    .empty-state {
      color: var(--text-muted);
      font-style: italic;
      padding: 0.5rem 0;
    }

    .summary-stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1rem;
      text-align: center;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 700;
    }

    .stat-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
    }

    @media (max-width: 640px) {
      .container { padding: 1.5rem 1rem; }
      h1 { font-size: 1.75rem; }
      .input-section { flex-direction: column; }
      .score-card { flex-direction: column; text-align: center; }
      .score-info { text-align: center; }
      .summary-stats { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>GEO Audit</h1>
      <p class="tagline">AI Search Visibility Analysis for Local Businesses</p>
    </header>

    <div class="input-section">
      <input type="url" id="urlInput" placeholder="https://example.com" autocomplete="url">
      <button id="analyzeBtn">Analyze</button>
    </div>

    <div id="status" class="status"></div>

    <div id="results" class="results">
      <div class="score-card">
        <div class="score-dial">
          <svg width="160" height="160" viewBox="0 0 160 160">
            <circle class="dial-track" cx="80" cy="80" r="68"/>
            <circle class="dial-progress" id="dialProgress" cx="80" cy="80" r="68"
                    stroke-dasharray="427" stroke-dashoffset="427"/>
          </svg>
          <div class="score-value">
            <span class="score-number" id="scoreNumber">0</span>
            <span class="score-label">GEO Score</span>
          </div>
        </div>
        <div class="score-info">
          <h2 id="scoreStatus">Analyzing...</h2>
          <div class="score-url" id="siteUrl"></div>
          <span class="score-badge" id="scoreBadge"></span>
        </div>
      </div>

      <div class="summary-stats">
        <div class="stat-card">
          <div class="stat-value" id="totalIssues" style="color: var(--critical)">0</div>
          <div class="stat-label">Total Issues</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="criticalStat" style="color: var(--critical)">0</div>
          <div class="stat-label">Critical</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="highStat" style="color: var(--high)">0</div>
          <div class="stat-label">High</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="mediumStat" style="color: var(--medium)">0</div>
          <div class="stat-label">Medium</div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">⚡ Top Priority Issues</div>
        <div id="topIssues"></div>
      </div>

      <details open>
        <summary>
          <h3>🔴 Critical Issues <span class="count-badge" id="criticalCount">0</span></h3>
          <span class="chevron">▼</span>
        </summary>
        <div class="details-content" id="criticalList"></div>
      </details>

      <details>
        <summary>
          <h3>🟠 High Priority <span class="count-badge" id="highCount">0</span></h3>
          <span class="chevron">▼</span>
        </summary>
        <div class="details-content" id="highList"></div>
      </details>

      <details>
        <summary>
          <h3>🔵 Medium Priority <span class="count-badge" id="mediumCount">0</span></h3>
          <span class="chevron">▼</span>
        </summary>
        <div class="details-content" id="mediumList"></div>
      </details>

      <details>
        <summary>
          <h3>⚪ Low Priority <span class="count-badge" id="lowCount">0</span></h3>
          <span class="chevron">▼</span>
        </summary>
        <div class="details-content" id="lowList"></div>
      </details>
    </div>
  </div>

  <script>
    const $ = id => document.getElementById(id);

    function getScoreColor(score) {
      if (score >= 70) return '#10b981';
      if (score >= 40) return '#f59e0b';
      return '#ef4444';
    }

    function getScoreStatus(score) {
      if (score >= 70) return { text: 'Strong', class: 'badge-good' };
      if (score >= 40) return { text: 'Needs Work', class: 'badge-warn' };
      return { text: 'Critical Issues', class: 'badge-bad' };
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderIssueCard(issue, showPriority = true) {
      return \`
        <div class="issue-card \${issue.priority}">
          <div class="issue-header">
            <span class="issue-title">\${escapeHtml(issue.title)}</span>
            \${showPriority ? \`<span class="priority-tag \${issue.priority}">\${issue.priority}</span>\` : ''}
          </div>
          <div class="issue-impact">\${escapeHtml(issue.impact)}</div>
          <div class="issue-evidence">\${escapeHtml(issue.evidence)}</div>
          <div class="issue-fix"><strong>Fix:</strong> \${escapeHtml(issue.recommendation)}</div>
        </div>
      \`;
    }

    function renderIssueList(issues) {
      if (!issues || issues.length === 0) {
        return '<div class="empty-state">No issues found</div>';
      }
      return issues.map(i => renderIssueCard(i, false)).join('');
    }

    async function runAudit() {
      const url = $('urlInput').value.trim();
      if (!url) {
        alert('Please enter a URL to analyze');
        return;
      }

      $('analyzeBtn').disabled = true;
      $('status').className = 'status';
      $('status').textContent = 'Fetching and analyzing site (this may take 10-15 seconds)...';
      $('results').classList.remove('visible');

      try {
        const response = await fetch('/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteUrl: url })
        });

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        // Update score dial
        const progress = $('dialProgress');
        const color = getScoreColor(data.score);
        progress.style.stroke = color;
        progress.style.strokeDashoffset = 427 - (data.score / 100) * 427;

        // Update score number
        $('scoreNumber').textContent = data.score;
        $('scoreNumber').style.color = color;

        // Update status
        const status = getScoreStatus(data.score);
        $('scoreStatus').textContent = status.text;
        $('scoreBadge').textContent = status.text;
        $('scoreBadge').className = 'score-badge ' + status.class;

        // Update URL
        $('siteUrl').textContent = data.siteUrl;

        // Update summary stats
        const counts = data.issuesByPriority;
        const total = counts.critical.length + counts.high.length + counts.medium.length + counts.low.length;
        $('totalIssues').textContent = total;
        $('criticalStat').textContent = counts.critical.length;
        $('highStat').textContent = counts.high.length;
        $('mediumStat').textContent = counts.medium.length;

        // Update top issues
        $('topIssues').innerHTML = data.topIssues.map(i => renderIssueCard(i)).join('');

        // Update issue counts and lists
        $('criticalCount').textContent = counts.critical.length;
        $('highCount').textContent = counts.high.length;
        $('mediumCount').textContent = counts.medium.length;
        $('lowCount').textContent = counts.low.length;

        $('criticalList').innerHTML = renderIssueList(counts.critical);
        $('highList').innerHTML = renderIssueList(counts.high);
        $('mediumList').innerHTML = renderIssueList(counts.medium);
        $('lowList').innerHTML = renderIssueList(counts.low);

        // Clear status and show results
        $('status').textContent = '';
        $('results').classList.add('visible');

      } catch (error) {
        $('status').className = 'status error';
        $('status').textContent = 'Error: ' + error.message;
      }

      $('analyzeBtn').disabled = false;
    }

    // Event listeners
    $('analyzeBtn').addEventListener('click', runAudit);
    $('urlInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') runAudit();
    });
  </script>
</body>
</html>`;

// ============================================================
// WORKER EXPORT
// ============================================================

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // GET / - Serve HTML UI
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(HTML_UI, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // POST /run - Run audit and return JSON
    if (request.method === 'POST' && url.pathname === '/run') {
      try {
        const body = await request.json() as { siteUrl?: string };

        if (!body.siteUrl) {
          return new Response(
            JSON.stringify({ error: 'siteUrl is required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const result = await runAudit(body.siteUrl);

        return new Response(
          JSON.stringify(result, null, 2),
          { headers: { 'Content-Type': 'application/json' } }
        );

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Audit failed';
        return new Response(
          JSON.stringify({ error: message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // GET /health - Health check
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 404 for everything else
    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  },
};
