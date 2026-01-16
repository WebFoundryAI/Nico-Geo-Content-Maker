/**
 * Nico GEO Audit Worker - Production Engine
 * Real HTML inspection with evidence-based findings
 */

// ============================================================
// TYPE DEFINITIONS
// ============================================================

interface Issue {
  id: string;
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

interface Signals {
  finalUrl: string;
  httpStatus: number;
  title: string;
  metaDescription: string;
  h1Count: number;
  h1Text: string;
  h2s: string[];
  h3s: string[];
  wordCount: number;
  bodyText: string;
  internalLinkCount: number;
  externalLinkCount: number;
  anchorTexts: string[];
  jsonLdTypes: string[];
  hasLocalBusinessSchema: boolean;
  hasOrganizationSchema: boolean;
  hasGeoKeywords: boolean;
  hasServiceKeywords: boolean;
  robotsNoindex: boolean;
  canonicalUrl: string;
  hasPhone: boolean;
  phoneNumbers: string[];
  hasEmail: boolean;
  emails: string[];
  hasAddress: boolean;
  addressSignals: string[];
}

// ============================================================
// CONSTANTS
// ============================================================

const WEIGHTS: Record<string, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
};

const GEO_TERMS = [
  'london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'liverpool', 'bristol',
  'sheffield', 'edinburgh', 'cardiff', 'belfast', 'newcastle', 'nottingham',
  'southampton', 'portsmouth', 'york', 'cambridge', 'oxford', 'brighton', 'bath',
  'new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia',
  'san antonio', 'san diego', 'dallas', 'san jose', 'austin', 'jacksonville',
  'fort worth', 'columbus', 'charlotte', 'seattle', 'denver', 'boston', 'portland',
  'local', 'near me', 'nearby', 'area', 'region', 'city', 'town', 'county',
  'district', 'neighborhood', 'serving', 'service area',
  'north', 'south', 'east', 'west', 'central', 'downtown', 'midtown', 'uptown',
];

const SERVICE_TERMS = [
  'plumber', 'plumbing', 'electrician', 'electrical', 'hvac', 'heating', 'cooling',
  'roofing', 'roofer', 'contractor', 'construction', 'landscaping', 'landscaper',
  'cleaning', 'cleaner', 'painting', 'painter', 'carpentry', 'carpenter',
  'locksmith', 'pest control', 'moving', 'mover', 'handyman', 'remodeling',
  'renovation', 'repair', 'installation', 'maintenance', 'emergency', '24/7',
  'same day', 'free estimate', 'licensed', 'insured', 'certified', 'professional',
  'expert', 'specialist', 'services', 'solutions', 'company', 'business',
];

// ============================================================
// HTML FETCHING
// ============================================================

async function fetchHtml(siteUrl: string): Promise<{ html: string; finalUrl: string; status: number }> {
  let url = siteUrl;
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

  const html = await response.text();
  return {
    html,
    finalUrl: response.url,
    status: response.status,
  };
}

// ============================================================
// SIGNAL EXTRACTION (HTMLRewriter + Regex)
// ============================================================

async function extractSignals(html: string, siteUrl: string, finalUrl: string, status: number): Promise<Signals> {
  const signals: Signals = {
    finalUrl,
    httpStatus: status,
    title: '',
    metaDescription: '',
    h1Count: 0,
    h1Text: '',
    h2s: [],
    h3s: [],
    wordCount: 0,
    bodyText: '',
    internalLinkCount: 0,
    externalLinkCount: 0,
    anchorTexts: [],
    jsonLdTypes: [],
    hasLocalBusinessSchema: false,
    hasOrganizationSchema: false,
    hasGeoKeywords: false,
    hasServiceKeywords: false,
    robotsNoindex: false,
    canonicalUrl: '',
    hasPhone: false,
    phoneNumbers: [],
    hasEmail: false,
    emails: [],
    hasAddress: false,
    addressSignals: [],
  };

  const host = new URL(finalUrl).hostname;

  // Use HTMLRewriter for structured extraction
  let currentTag = '';
  let currentText = '';
  const h1Texts: string[] = [];

  const rewriter = new HTMLRewriter()
    .on('title', {
      element() { currentTag = 'title'; currentText = ''; },
      text({ text }) { if (currentTag === 'title') currentText += text; },
    })
    .on('h1', {
      element() {
        currentTag = 'h1';
        currentText = '';
        signals.h1Count++;
      },
      text({ text }) { if (currentTag === 'h1') currentText += text; },
    })
    .on('h2', {
      element() { currentTag = 'h2'; currentText = ''; },
      text({ text }) { if (currentTag === 'h2') currentText += text; },
    })
    .on('h3', {
      element() { currentTag = 'h3'; currentText = ''; },
      text({ text }) { if (currentTag === 'h3') currentText += text; },
    })
    .on('meta', {
      element(el) {
        const name = (el.getAttribute('name') || '').toLowerCase();
        const content = el.getAttribute('content') || '';
        const httpEquiv = (el.getAttribute('http-equiv') || '').toLowerCase();

        if (name === 'description') {
          signals.metaDescription = content;
        }
        if (name === 'robots' && content.toLowerCase().includes('noindex')) {
          signals.robotsNoindex = true;
        }
        if (httpEquiv === 'refresh' && content.includes('noindex')) {
          signals.robotsNoindex = true;
        }
      },
    })
    .on('link[rel="canonical"]', {
      element(el) {
        signals.canonicalUrl = el.getAttribute('href') || '';
      },
    })
    .on('a', {
      element(el) {
        const href = el.getAttribute('href') || '';
        if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
          if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../') || href.includes(host)) {
            signals.internalLinkCount++;
          } else if (href.startsWith('http')) {
            signals.externalLinkCount++;
          }
        }
        currentTag = 'a';
        currentText = '';
      },
      text({ text }) { if (currentTag === 'a') currentText += text; },
    })
    .on('script[type="application/ld+json"]', {
      element() { currentTag = 'jsonld'; currentText = ''; },
      text({ text }) { if (currentTag === 'jsonld') currentText += text; },
    })
    .on('body', {
      element() { currentTag = 'body'; },
    })
    .on('body *', {
      text({ text }) {
        if (!['script', 'style', 'noscript'].includes(currentTag)) {
          signals.bodyText += text + ' ';
        }
      },
    });

  // Create a Response to transform
  const response = new Response(html);
  const transformedResponse = rewriter.transform(response);

  // We need to handle end tags manually with regex since HTMLRewriter doesn't have end handlers
  await transformedResponse.text();

  // Parse with regex for elements that need end-tag handling
  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) signals.title = titleMatch[1].trim();

  // H1s
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let h1Match;
  while ((h1Match = h1Regex.exec(html)) !== null) {
    const text = h1Match[1].replace(/<[^>]+>/g, '').trim();
    if (text && !signals.h1Text) signals.h1Text = text;
    h1Texts.push(text);
  }
  signals.h1Count = h1Texts.length;

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

  // Meta description (backup)
  if (!signals.metaDescription) {
    const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    if (metaMatch) signals.metaDescription = metaMatch[1];
  }

  // Robots noindex (backup)
  if (!signals.robotsNoindex) {
    const robotsMatch = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i);
    if (robotsMatch && robotsMatch[1].toLowerCase().includes('noindex')) {
      signals.robotsNoindex = true;
    }
  }

  // Canonical (backup)
  if (!signals.canonicalUrl) {
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    if (canonicalMatch) signals.canonicalUrl = canonicalMatch[1];
  }

  // JSON-LD Schema
  const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    const content = jsonLdMatch[1].toLowerCase();

    // Extract @type values
    const typeRegex = /"@type"\s*:\s*"([^"]+)"/g;
    let typeMatch;
    while ((typeMatch = typeRegex.exec(content)) !== null) {
      signals.jsonLdTypes.push(typeMatch[1]);
    }

    // Check for LocalBusiness variants
    if (content.includes('localbusiness') ||
        content.includes('plumber') ||
        content.includes('electrician') ||
        content.includes('hvacbusiness') ||
        content.includes('homeandconstructionbusiness') ||
        content.includes('professionalservice') ||
        content.includes('localservice')) {
      signals.hasLocalBusinessSchema = true;
    }

    // Check for Organization
    if (content.includes('"organization"') || content.includes('"@type":"organization"')) {
      signals.hasOrganizationSchema = true;
    }
  }

  // Extract body text for analysis (strip HTML)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    const bodyHtml = bodyMatch[1];
    // Remove script and style content
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

  // Check for geo keywords in key areas
  const keyContent = (signals.title + ' ' + signals.h1Text + ' ' + signals.metaDescription + ' ' + signals.h2s.join(' ')).toLowerCase();
  signals.hasGeoKeywords = GEO_TERMS.some(term => keyContent.includes(term.toLowerCase()));
  signals.hasServiceKeywords = SERVICE_TERMS.some(term => keyContent.includes(term.toLowerCase()));

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

  // Anchor texts
  const anchorRegex = /<a[^>]*>([^<]+)<\/a>/gi;
  let anchorMatch;
  while ((anchorMatch = anchorRegex.exec(html)) !== null) {
    const text = anchorMatch[1].trim();
    if (text && text.length > 2 && text.length < 100) {
      signals.anchorTexts.push(text);
    }
  }

  return signals;
}

// ============================================================
// CHECK FUNCTIONS - Returns Issues
// ============================================================

function runChecks(signals: Signals): Issue[] {
  const issues: Issue[] = [];

  // CRITICAL: Indexability blocked
  if (signals.robotsNoindex) {
    issues.push({
      id: 'noindex-blocked',
      title: 'Page Blocked from Indexing',
      priority: 'critical',
      evidence: 'Found <meta name="robots" content="noindex"> - search engines and AI will NOT index this page',
      impact: 'Your page is completely invisible to search engines and AI assistants. No traffic can come from search.',
      recommendation: 'Remove the noindex directive immediately unless this is intentional for a staging/private page.',
    });
  }

  // CRITICAL: Missing title
  if (!signals.title || signals.title.length < 10) {
    issues.push({
      id: 'missing-title',
      title: 'Missing or Invalid Page Title',
      priority: 'critical',
      evidence: signals.title
        ? `Title found: "${signals.title}" (${signals.title.length} characters - too short)`
        : 'No <title> tag found in the HTML',
      impact: 'The title is the #1 ranking signal. Without a proper title, search engines and AI cannot understand or rank your page.',
      recommendation: 'Add a descriptive title (50-60 chars) with your primary service and location, e.g., "Emergency Plumber in North London | 24/7 Service | CompanyName"',
    });
  }

  // CRITICAL: Missing H1
  if (signals.h1Count === 0) {
    issues.push({
      id: 'missing-h1',
      title: 'Missing H1 Heading',
      priority: 'critical',
      evidence: 'No <h1> tag found on the page',
      impact: 'The H1 is the primary heading that tells AI what this page is about. Without it, AI cannot accurately categorize or cite your page.',
      recommendation: 'Add a single H1 heading that states your main service and location, e.g., <h1>Professional Plumbing Services in Manchester</h1>',
    });
  }

  // CRITICAL: No schema markup
  if (!signals.hasLocalBusinessSchema && !signals.hasOrganizationSchema) {
    issues.push({
      id: 'no-schema',
      title: 'Missing Business Schema Markup',
      priority: 'critical',
      evidence: signals.jsonLdTypes.length > 0
        ? `Found schema types: ${signals.jsonLdTypes.join(', ')} - but no LocalBusiness or Organization`
        : 'No JSON-LD structured data found on the page',
      impact: 'Structured data tells AI exactly what your business is, where you operate, and how to contact you. Without it, AI assistants cannot recommend you accurately.',
      recommendation: 'Add JSON-LD LocalBusiness schema with: @type, name, address, telephone, areaServed, priceRange, and openingHours.',
    });
  }

  // HIGH: Thin content
  if (signals.wordCount < 300) {
    issues.push({
      id: 'thin-content',
      title: 'Critically Thin Content',
      priority: 'critical',
      evidence: `Page has only ${signals.wordCount} words (minimum recommended: 500 words)`,
      impact: 'AI engines need substantial content to understand your expertise and cite you. Pages under 300 words are rarely shown in AI responses.',
      recommendation: 'Expand content to 800+ words. Add: detailed service descriptions, FAQs, service areas, pricing info, and expertise statements.',
    });
  } else if (signals.wordCount < 500) {
    issues.push({
      id: 'low-content',
      title: 'Limited Content Depth',
      priority: 'high',
      evidence: `Page has ${signals.wordCount} words (recommended: 800+ words)`,
      impact: 'Comprehensive content outperforms thin pages in both search and AI citations.',
      recommendation: 'Add more detail: FAQs, process explanations, service area specifics, testimonials context.',
    });
  }

  // HIGH: Missing meta description
  if (!signals.metaDescription || signals.metaDescription.length < 50) {
    issues.push({
      id: 'missing-meta-description',
      title: 'Missing or Weak Meta Description',
      priority: 'high',
      evidence: signals.metaDescription
        ? `Meta description: "${signals.metaDescription.substring(0, 80)}..." (${signals.metaDescription.length} chars - too short)`
        : 'No meta description found',
      impact: 'The meta description is your elevator pitch. AI uses it to understand page intent and users see it in search results.',
      recommendation: 'Write a 150-160 character description: [Service] in [Location]. [Unique value prop]. [Call to action]. [Contact method].',
    });
  }

  // HIGH: No geo targeting
  if (!signals.hasGeoKeywords) {
    issues.push({
      id: 'no-geo-targeting',
      title: 'No Geographic Targeting',
      priority: 'high',
      evidence: 'No location keywords found in title, H1, H2s, or meta description',
      impact: 'Local businesses must signal their service area. AI cannot recommend you for local queries without location signals.',
      recommendation: 'Add your city/area to the title and H1. Create location-specific content mentioning neighborhoods and service areas.',
    });
  }

  // HIGH: Multiple or missing H1s
  if (signals.h1Count > 1) {
    issues.push({
      id: 'multiple-h1s',
      title: 'Multiple H1 Headings',
      priority: 'high',
      evidence: `Found ${signals.h1Count} H1 tags on the page - should only have one`,
      impact: 'Multiple H1s dilute the page focus and confuse search engines about the primary topic.',
      recommendation: 'Keep only one H1 for the main topic. Convert other H1s to H2s for subtopics.',
    });
  }

  // HIGH: Missing NAP (for local businesses)
  if (!signals.hasPhone && !signals.hasEmail) {
    issues.push({
      id: 'missing-contact',
      title: 'No Contact Information Visible',
      priority: 'high',
      evidence: 'No phone number or email address detected on the page',
      impact: 'Contact info is essential for local SEO and builds trust. AI may not recommend businesses without clear contact methods.',
      recommendation: 'Add your phone number and email prominently. Include them in the header/footer and on a dedicated contact section.',
    });
  }

  // MEDIUM: Weak internal linking
  if (signals.internalLinkCount < 5) {
    issues.push({
      id: 'weak-internal-links',
      title: 'Insufficient Internal Linking',
      priority: 'medium',
      evidence: `Only ${signals.internalLinkCount} internal links found (recommended: 10+)`,
      impact: 'Internal links help search engines discover content and understand site structure. They also keep users engaged.',
      recommendation: 'Add links to: service pages, area pages, about, contact, FAQs, blog posts. Each page should link to 10+ other pages.',
    });
  }

  // MEDIUM: No service keywords
  if (!signals.hasServiceKeywords) {
    issues.push({
      id: 'no-service-keywords',
      title: 'Weak Service Keyword Usage',
      priority: 'medium',
      evidence: 'No clear service keywords found in key page elements (title, H1, H2s, meta)',
      impact: 'AI needs to understand what services you offer to recommend you for relevant queries.',
      recommendation: 'Include specific service terms in your headings: "Emergency Plumbing", "Drain Cleaning", "Boiler Repair", etc.',
    });
  }

  // MEDIUM: Flat heading structure
  if (signals.h1Count > 0 && signals.h2s.length === 0) {
    issues.push({
      id: 'flat-headings',
      title: 'Flat Heading Structure',
      priority: 'medium',
      evidence: `Found H1 but no H2 subheadings (${signals.h3s.length} H3s found)`,
      impact: 'A proper H1→H2→H3 hierarchy helps AI parse page sections and extract specific information.',
      recommendation: 'Add H2 headings for each major section: Services, About, Areas Served, FAQs, Contact.',
    });
  }

  // MEDIUM: Duplicate anchor text
  const anchorCounts = new Map<string, number>();
  signals.anchorTexts.forEach(t => {
    const lower = t.toLowerCase();
    anchorCounts.set(lower, (anchorCounts.get(lower) || 0) + 1);
  });
  const duplicateAnchors = [...anchorCounts.entries()].filter(([_, count]) => count > 3);
  if (duplicateAnchors.length > 0) {
    issues.push({
      id: 'duplicate-anchors',
      title: 'Repetitive Anchor Text',
      priority: 'medium',
      evidence: `Overused anchors: ${duplicateAnchors.slice(0, 3).map(([text, count]) => `"${text}" (${count}x)`).join(', ')}`,
      impact: 'Repetitive anchor text looks spammy and wastes opportunities to use varied, descriptive links.',
      recommendation: 'Vary your anchor text to be descriptive: "our plumbing services" instead of "click here" repeated.',
    });
  }

  // MEDIUM: Missing address for local business
  if (signals.hasLocalBusinessSchema && !signals.hasAddress) {
    issues.push({
      id: 'missing-address',
      title: 'No Physical Address Displayed',
      priority: 'medium',
      evidence: 'LocalBusiness schema detected but no street address found on page',
      impact: 'Physical address reinforces local relevance and is required for Google Business Profile alignment.',
      recommendation: 'Display your full business address on the page, especially in the footer and contact section.',
    });
  }

  // LOW: Title length optimization
  if (signals.title && (signals.title.length < 30 || signals.title.length > 65)) {
    issues.push({
      id: 'title-length',
      title: 'Suboptimal Title Length',
      priority: 'low',
      evidence: `Title is ${signals.title.length} characters (optimal: 50-60)`,
      impact: 'Titles under 30 chars underuse available space. Over 65 chars get truncated in search results.',
      recommendation: 'Adjust title to 50-60 characters to maximize visibility and click-through.',
    });
  }

  // LOW: Meta description length optimization
  if (signals.metaDescription && (signals.metaDescription.length < 120 || signals.metaDescription.length > 165)) {
    issues.push({
      id: 'meta-length',
      title: 'Suboptimal Meta Description Length',
      priority: 'low',
      evidence: `Meta description is ${signals.metaDescription.length} characters (optimal: 150-160)`,
      impact: 'Short descriptions waste SERP real estate. Long ones get truncated.',
      recommendation: 'Adjust to 150-160 characters for full display in search results.',
    });
  }

  // LOW: Missing canonical
  if (!signals.canonicalUrl) {
    issues.push({
      id: 'missing-canonical',
      title: 'Missing Canonical Tag',
      priority: 'low',
      evidence: 'No <link rel="canonical"> found',
      impact: 'Canonical tags prevent duplicate content issues and consolidate ranking signals.',
      recommendation: 'Add <link rel="canonical" href="https://yourdomain.com/page-url"> to the <head>.',
    });
  }

  // LOW: Few H2s
  if (signals.h2s.length > 0 && signals.h2s.length < 3 && signals.wordCount > 500) {
    issues.push({
      id: 'few-subheadings',
      title: 'Limited Subheadings',
      priority: 'low',
      evidence: `Only ${signals.h2s.length} H2 subheadings for ${signals.wordCount} words`,
      impact: 'More subheadings improve scannability and help AI extract specific sections.',
      recommendation: 'Add an H2 every 200-300 words to break up content into logical sections.',
    });
  }

  return issues;
}

// ============================================================
// SCORING
// ============================================================

function scoreSite(issues: Issue[]): number {
  let score = 100;

  for (const issue of issues) {
    score -= WEIGHTS[issue.priority] || 0;
  }

  return Math.max(0, Math.min(100, score));
}

// ============================================================
// MAIN AUDIT FUNCTION
// ============================================================

async function runAudit(siteUrl: string): Promise<AuditResponse> {
  // Fetch the HTML
  const { html, finalUrl, status } = await fetchHtml(siteUrl);

  if (status >= 400) {
    throw new Error(`HTTP ${status} - Cannot access page`);
  }

  // Extract signals from the HTML
  const signals = await extractSignals(html, siteUrl, finalUrl, status);

  // Run all checks
  const allIssues = runChecks(signals);

  // Calculate score
  const score = scoreSite(allIssues);

  // Sort by priority for top issues
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedIssues = [...allIssues].sort((a, b) =>
    priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  // Build response
  return {
    siteUrl: finalUrl,
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

    /* Score Card */
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

    /* Section Headers */
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

    /* Issue Cards */
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

    /* Expandable Sections */
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

    /* Responsive */
    @media (max-width: 640px) {
      .container { padding: 1.5rem 1rem; }
      h1 { font-size: 1.75rem; }
      .input-section { flex-direction: column; }
      .score-card { flex-direction: column; text-align: center; }
      .score-info { text-align: center; }
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
      $('status').textContent = 'Fetching and analyzing page...';
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

        // Update top issues
        $('topIssues').innerHTML = data.topIssues.map(i => renderIssueCard(i)).join('');

        // Update issue counts and lists
        const counts = data.issuesByPriority;
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
