/**
 * Nico GEO Audit Worker
 * Production-ready SEO audit for AI search visibility
 */

interface Finding {
  id: string;
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  why_it_matters: string;
  evidence: string;
  fix_recommendation: string;
  weight: number;
}

interface AuditResult {
  siteUrl: string;
  overallScore: number;
  top3: Finding[];
  groups: {
    critical: Finding[];
    high: Finding[];
    medium: Finding[];
    low: Finding[];
  };
  meta: {
    title: string;
    description: string;
    h1: string;
    wordCount: number;
    internalLinks: number;
    hasLocalBusinessSchema: boolean;
    hasGeoModifiers: boolean;
  };
}

interface PageData {
  title: string;
  metaDescription: string;
  h1: string;
  h2s: string[];
  h3s: string[];
  wordCount: number;
  bodyText: string;
  internalLinks: string[];
  anchorTexts: string[];
  jsonLdTypes: string[];
  hasLocalBusinessSchema: boolean;
  hasGeoModifiers: boolean;
}

const PRIORITY_WEIGHTS = { critical: 25, high: 15, medium: 8, low: 3 };

const GEO_TERMS = [
  'london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'liverpool', 'bristol', 'sheffield',
  'edinburgh', 'cardiff', 'belfast', 'newcastle', 'nottingham', 'southampton', 'portsmouth',
  'local', 'near me', 'nearby', 'area', 'region', 'city', 'town', 'county', 'district',
  'north', 'south', 'east', 'west', 'central'
];

class HTMLParser {
  data: PageData = {
    title: '',
    metaDescription: '',
    h1: '',
    h2s: [],
    h3s: [],
    wordCount: 0,
    bodyText: '',
    internalLinks: [],
    anchorTexts: [],
    jsonLdTypes: [],
    hasLocalBusinessSchema: false,
    hasGeoModifiers: false,
  };

  private currentTag = '';
  private currentText = '';
  private baseHost = '';

  constructor(baseUrl: string) {
    try {
      this.baseHost = new URL(baseUrl).hostname;
    } catch {}
  }

  titleHandler = {
    element: () => { this.currentTag = 'title'; this.currentText = ''; },
    text: ({ text }: { text: string }) => { if (this.currentTag === 'title') this.currentText += text; },
    comments: () => {},
  };

  titleEnd = () => { this.data.title = this.currentText.trim(); this.currentTag = ''; };

  h1Handler = {
    element: () => { this.currentTag = 'h1'; this.currentText = ''; },
    text: ({ text }: { text: string }) => { if (this.currentTag === 'h1') this.currentText += text; },
  };

  h1End = () => { if (!this.data.h1) this.data.h1 = this.currentText.trim(); this.currentTag = ''; };

  h2Handler = {
    element: () => { this.currentTag = 'h2'; this.currentText = ''; },
    text: ({ text }: { text: string }) => { if (this.currentTag === 'h2') this.currentText += text; },
  };

  h2End = () => { this.data.h2s.push(this.currentText.trim()); this.currentTag = ''; };

  h3Handler = {
    element: () => { this.currentTag = 'h3'; this.currentText = ''; },
    text: ({ text }: { text: string }) => { if (this.currentTag === 'h3') this.currentText += text; },
  };

  h3End = () => { this.data.h3s.push(this.currentText.trim()); this.currentTag = ''; };

  metaHandler = {
    element: (el: any) => {
      const name = (el.getAttribute('name') || '').toLowerCase();
      const content = el.getAttribute('content') || '';
      if (name === 'description') this.data.metaDescription = content;
    },
  };

  linkHandler = {
    element: (el: any) => {
      const href = el.getAttribute('href') || '';
      if (href.startsWith('/') || href.startsWith('./') || href.includes(this.baseHost)) {
        this.data.internalLinks.push(href);
      }
      this.currentTag = 'a';
      this.currentText = '';
    },
    text: ({ text }: { text: string }) => { if (this.currentTag === 'a') this.currentText += text; },
  };

  linkEnd = () => {
    const anchor = this.currentText.trim();
    if (anchor) this.data.anchorTexts.push(anchor);
    this.currentTag = '';
  };

  scriptHandler = {
    element: (el: any) => {
      const type = el.getAttribute('type') || '';
      if (type === 'application/ld+json') {
        this.currentTag = 'jsonld';
        this.currentText = '';
      }
    },
    text: ({ text }: { text: string }) => { if (this.currentTag === 'jsonld') this.currentText += text; },
  };

  scriptEnd = () => {
    if (this.currentTag === 'jsonld') {
      const content = this.currentText.toLowerCase();
      if (content.includes('@type')) {
        const typeMatch = content.match(/"@type"\s*:\s*"([^"]+)"/g);
        if (typeMatch) {
          typeMatch.forEach(m => {
            const t = m.match(/"@type"\s*:\s*"([^"]+)"/);
            if (t) this.data.jsonLdTypes.push(t[1]);
          });
        }
      }
      if (content.includes('localbusiness') || content.includes('plumber') ||
          content.includes('electrician') || content.includes('contractor') ||
          content.includes('homeandconstructionbusiness') || content.includes('professionalservice')) {
        this.data.hasLocalBusinessSchema = true;
      }
    }
    this.currentTag = '';
  };

  bodyHandler = {
    text: ({ text }: { text: string }) => { this.data.bodyText += text + ' '; },
  };

  finalize() {
    const clean = this.data.bodyText.replace(/\s+/g, ' ').trim();
    this.data.wordCount = clean.split(/\s+/).filter(w => w.length > 2).length;

    const checkText = (this.data.title + ' ' + this.data.h1 + ' ' + this.data.metaDescription).toLowerCase();
    this.data.hasGeoModifiers = GEO_TERMS.some(term => checkText.includes(term));
  }
}

function analyze(data: PageData, siteUrl: string): AuditResult {
  const findings: Finding[] = [];
  let score = 100;

  // CRITICAL: Missing title
  if (!data.title || data.title.length < 10) {
    findings.push({
      id: 'missing-title',
      title: 'Missing or Invalid Page Title',
      priority: 'critical',
      why_it_matters: 'Search engines and AI use the title as the primary identifier for your page. Without it, you cannot rank.',
      evidence: data.title ? `Title found: "${data.title}" (${data.title.length} chars)` : 'No <title> tag found',
      fix_recommendation: 'Add a descriptive title 50-60 characters long including your service and location.',
      weight: PRIORITY_WEIGHTS.critical,
    });
    score -= PRIORITY_WEIGHTS.critical;
  }

  // CRITICAL: Missing H1
  if (!data.h1) {
    findings.push({
      id: 'missing-h1',
      title: 'Missing H1 Heading',
      priority: 'critical',
      why_it_matters: 'The H1 is the most important on-page heading. AI engines use it to understand page topic.',
      evidence: 'No <h1> tag found on the page',
      fix_recommendation: 'Add a single H1 that clearly states your primary service and location.',
      weight: PRIORITY_WEIGHTS.critical,
    });
    score -= PRIORITY_WEIGHTS.critical;
  }

  // CRITICAL: Thin content
  if (data.wordCount < 300) {
    findings.push({
      id: 'thin-content',
      title: 'Critically Thin Content',
      priority: 'critical',
      why_it_matters: 'AI engines need substantial content to understand and cite your expertise. Pages under 300 words rarely rank.',
      evidence: `Only ${data.wordCount} words found. Minimum recommended: 500+`,
      fix_recommendation: 'Expand content to 800+ words covering services, process, FAQs, and local information.',
      weight: PRIORITY_WEIGHTS.critical,
    });
    score -= PRIORITY_WEIGHTS.critical;
  } else if (data.wordCount < 500) {
    findings.push({
      id: 'low-content',
      title: 'Limited Content Depth',
      priority: 'high',
      why_it_matters: 'Comprehensive content outperforms thin pages. 500-800 words is minimum for competitive queries.',
      evidence: `${data.wordCount} words found. Recommended: 800+`,
      fix_recommendation: 'Add detailed service descriptions, customer FAQs, and local expertise sections.',
      weight: PRIORITY_WEIGHTS.high,
    });
    score -= PRIORITY_WEIGHTS.high;
  }

  // HIGH: Missing meta description
  if (!data.metaDescription || data.metaDescription.length < 50) {
    findings.push({
      id: 'missing-meta-desc',
      title: 'Missing Meta Description',
      priority: 'high',
      why_it_matters: 'Meta descriptions influence click-through rates and help AI understand page purpose.',
      evidence: data.metaDescription ? `Description: "${data.metaDescription.slice(0, 50)}..." (${data.metaDescription.length} chars)` : 'No meta description found',
      fix_recommendation: 'Write a compelling 150-160 character description with service, location, and call-to-action.',
      weight: PRIORITY_WEIGHTS.high,
    });
    score -= PRIORITY_WEIGHTS.high;
  }

  // HIGH: No LocalBusiness schema
  if (!data.hasLocalBusinessSchema) {
    findings.push({
      id: 'no-local-schema',
      title: 'Missing LocalBusiness Schema',
      priority: 'high',
      why_it_matters: 'Structured data helps AI engines understand your business type, location, and services.',
      evidence: `Found schema types: ${data.jsonLdTypes.length > 0 ? data.jsonLdTypes.join(', ') : 'None'}`,
      fix_recommendation: 'Add JSON-LD with LocalBusiness or relevant service type including name, address, phone, and service area.',
      weight: PRIORITY_WEIGHTS.high,
    });
    score -= PRIORITY_WEIGHTS.high;
  }

  // HIGH: No geo modifiers
  if (!data.hasGeoModifiers) {
    findings.push({
      id: 'no-geo-modifiers',
      title: 'No Geographic Targeting',
      priority: 'high',
      why_it_matters: 'Local service businesses must signal their service area. AI cannot recommend you for local queries without location signals.',
      evidence: 'No city, area, or location terms found in title, H1, or meta description',
      fix_recommendation: 'Include your primary service area in title and H1: e.g., "Emergency Plumber in North London"',
      weight: PRIORITY_WEIGHTS.high,
    });
    score -= PRIORITY_WEIGHTS.high;
  }

  // MEDIUM: Few internal links
  if (data.internalLinks.length < 5) {
    findings.push({
      id: 'weak-internal-links',
      title: 'Weak Internal Linking',
      priority: 'medium',
      why_it_matters: 'Internal links distribute page authority and help AI understand site structure.',
      evidence: `Only ${data.internalLinks.length} internal links found`,
      fix_recommendation: 'Add links to service pages, area pages, about, and contact. Aim for 10+ contextual internal links.',
      weight: PRIORITY_WEIGHTS.medium,
    });
    score -= PRIORITY_WEIGHTS.medium;
  }

  // MEDIUM: Duplicate anchor text
  const anchorCounts = new Map<string, number>();
  data.anchorTexts.forEach(a => {
    const lower = a.toLowerCase().trim();
    if (lower.length > 2) anchorCounts.set(lower, (anchorCounts.get(lower) || 0) + 1);
  });
  const duplicates = [...anchorCounts.entries()].filter(([_, count]) => count > 3);
  if (duplicates.length > 0) {
    findings.push({
      id: 'duplicate-anchors',
      title: 'Duplicate Internal Anchor Text',
      priority: 'medium',
      why_it_matters: 'Repeated anchor text looks spammy and wastes linking opportunities.',
      evidence: `Overused anchors: ${duplicates.map(([text, count]) => `"${text}" (${count}x)`).slice(0, 3).join(', ')}`,
      fix_recommendation: 'Vary anchor text to be descriptive and contextual.',
      weight: PRIORITY_WEIGHTS.medium,
    });
    score -= PRIORITY_WEIGHTS.medium;
  }

  // MEDIUM: No heading hierarchy
  if (data.h1 && data.h2s.length === 0) {
    findings.push({
      id: 'flat-heading-structure',
      title: 'Flat Heading Structure',
      priority: 'medium',
      why_it_matters: 'Proper H1→H2→H3 hierarchy helps AI parse content sections.',
      evidence: 'H1 present but no H2 subheadings found',
      fix_recommendation: 'Break content into sections with descriptive H2 headings for each service or topic.',
      weight: PRIORITY_WEIGHTS.medium,
    });
    score -= PRIORITY_WEIGHTS.medium;
  }

  // LOW: Title length optimization
  if (data.title && (data.title.length < 30 || data.title.length > 65)) {
    findings.push({
      id: 'title-length',
      title: 'Suboptimal Title Length',
      priority: 'low',
      why_it_matters: 'Titles between 50-60 characters display fully in search results.',
      evidence: `Current title: ${data.title.length} characters`,
      fix_recommendation: 'Adjust title to 50-60 characters for optimal display.',
      weight: PRIORITY_WEIGHTS.low,
    });
    score -= PRIORITY_WEIGHTS.low;
  }

  // LOW: Meta description length
  if (data.metaDescription && (data.metaDescription.length < 120 || data.metaDescription.length > 160)) {
    findings.push({
      id: 'meta-desc-length',
      title: 'Suboptimal Meta Description Length',
      priority: 'low',
      why_it_matters: 'Descriptions between 150-160 characters maximize SERP real estate.',
      evidence: `Current description: ${data.metaDescription.length} characters`,
      fix_recommendation: 'Adjust to 150-160 characters with clear value proposition.',
      weight: PRIORITY_WEIGHTS.low,
    });
    score -= PRIORITY_WEIGHTS.low;
  }

  score = Math.max(0, Math.min(100, score));

  const sorted = [...findings].sort((a, b) => b.weight - a.weight);

  return {
    siteUrl,
    overallScore: score,
    top3: sorted.slice(0, 3),
    groups: {
      critical: findings.filter(f => f.priority === 'critical'),
      high: findings.filter(f => f.priority === 'high'),
      medium: findings.filter(f => f.priority === 'medium'),
      low: findings.filter(f => f.priority === 'low'),
    },
    meta: {
      title: data.title,
      description: data.metaDescription,
      h1: data.h1,
      wordCount: data.wordCount,
      internalLinks: data.internalLinks.length,
      hasLocalBusinessSchema: data.hasLocalBusinessSchema,
      hasGeoModifiers: data.hasGeoModifiers,
    },
  };
}

async function runAudit(siteUrl: string): Promise<AuditResult> {
  if (!siteUrl.startsWith('http://') && !siteUrl.startsWith('https://')) {
    siteUrl = 'https://' + siteUrl;
  }

  const response = await fetch(siteUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NicoGEOBot/1.0; +https://nicogeo.ai)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Site returned HTTP ${response.status}`);
  }

  const parser = new HTMLParser(siteUrl);

  const rewriter = new HTMLRewriter()
    .on('title', { element: parser.titleHandler.element, text: parser.titleHandler.text })
    .on('h1', { element: parser.h1Handler.element, text: parser.h1Handler.text })
    .on('h2', { element: parser.h2Handler.element, text: parser.h2Handler.text })
    .on('h3', { element: parser.h3Handler.element, text: parser.h3Handler.text })
    .on('meta', parser.metaHandler)
    .on('a', { element: parser.linkHandler.element, text: parser.linkHandler.text })
    .on('script[type="application/ld+json"]', { element: parser.scriptHandler.element, text: parser.scriptHandler.text })
    .on('body *', parser.bodyHandler);

  await rewriter.transform(response).text();

  parser.finalize();

  return analyze(parser.data, siteUrl);
}

const HTML_UI = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GEO Audit</title>
  <style>
    :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #f1f5f9; --muted: #94a3b8; --critical: #ef4444; --high: #f59e0b; --medium: #3b82f6; --low: #64748b; --success: #10b981; --purple: #8b5cf6; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; padding: 2rem 1rem; }
    h1 { font-size: 2rem; text-align: center; margin-bottom: 0.5rem; background: linear-gradient(90deg, var(--purple), var(--critical)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { text-align: center; color: var(--muted); margin-bottom: 2rem; }
    .input-row { display: flex; gap: 0.75rem; margin-bottom: 2rem; }
    input[type="url"] { flex: 1; padding: 1rem; font-size: 1rem; background: var(--card); border: 1px solid var(--border); border-radius: 0.5rem; color: var(--text); outline: none; }
    input:focus { border-color: var(--purple); }
    button { padding: 1rem 2rem; font-size: 1rem; font-weight: 600; background: linear-gradient(90deg, var(--purple), #6366f1); border: none; border-radius: 0.5rem; color: white; cursor: pointer; transition: transform 0.2s; }
    button:hover { transform: translateY(-2px); }
    button:disabled { opacity: 0.5; cursor: wait; transform: none; }
    .status { text-align: center; padding: 1rem; color: var(--muted); }
    .error { color: var(--critical); background: rgba(239,68,68,0.1); border-radius: 0.5rem; }
    .results { display: none; }
    .results.show { display: block; }
    .score-card { display: flex; align-items: center; gap: 2rem; background: var(--card); border: 1px solid var(--border); border-radius: 1rem; padding: 2rem; margin-bottom: 2rem; }
    .dial { position: relative; width: 140px; height: 140px; flex-shrink: 0; }
    .dial svg { transform: rotate(-90deg); }
    .dial-bg { fill: none; stroke: var(--border); stroke-width: 10; }
    .dial-progress { fill: none; stroke-width: 10; stroke-linecap: round; transition: stroke-dashoffset 0.8s ease; }
    .dial-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .dial-score { font-size: 2.5rem; font-weight: 700; }
    .dial-label { font-size: 0.75rem; color: var(--muted); }
    .score-info h2 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .score-url { color: var(--muted); font-size: 0.875rem; word-break: break-all; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 1rem; font-size: 0.75rem; font-weight: 600; margin-top: 0.5rem; }
    .badge-strong { background: var(--success); }
    .badge-work { background: var(--high); }
    .badge-not { background: var(--critical); }
    .section { margin-bottom: 1.5rem; }
    .section-header { display: flex; justify-content: space-between; align-items: center; background: var(--card); border: 1px solid var(--border); border-radius: 0.5rem; padding: 1rem; cursor: pointer; }
    .section-header:hover { background: #253047; }
    .section-title { font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
    .section-count { background: var(--border); padding: 0.125rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; }
    .chevron { transition: transform 0.3s; }
    .chevron.open { transform: rotate(180deg); }
    .section-content { display: none; padding-top: 1rem; }
    .section-content.show { display: block; }
    .finding { background: var(--card); border: 1px solid var(--border); border-left: 4px solid; border-radius: 0.5rem; padding: 1.25rem; margin-bottom: 1rem; }
    .finding.critical { border-left-color: var(--critical); }
    .finding.high { border-left-color: var(--high); }
    .finding.medium { border-left-color: var(--medium); }
    .finding.low { border-left-color: var(--low); }
    .finding-header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem; }
    .finding-title { font-weight: 600; }
    .priority-badge { padding: 0.2rem 0.6rem; border-radius: 1rem; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
    .priority-badge.critical { background: rgba(239,68,68,0.2); color: var(--critical); }
    .priority-badge.high { background: rgba(245,158,11,0.2); color: var(--high); }
    .priority-badge.medium { background: rgba(59,130,246,0.2); color: var(--medium); }
    .priority-badge.low { background: rgba(100,116,139,0.2); color: var(--low); }
    .finding-why { color: var(--muted); font-size: 0.9rem; margin-bottom: 0.75rem; }
    .finding-evidence { background: rgba(0,0,0,0.2); padding: 0.75rem; border-radius: 0.25rem; font-size: 0.85rem; margin-bottom: 0.75rem; font-family: monospace; }
    .finding-fix { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); padding: 0.75rem; border-radius: 0.25rem; font-size: 0.875rem; }
    .finding-fix strong { color: var(--success); }
    .top3-header { font-size: 1.25rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }
    .top3-icon { background: linear-gradient(135deg, var(--critical), var(--high)); padding: 0.5rem; border-radius: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>GEO Audit</h1>
    <p class="subtitle">SEO analysis for AI search visibility</p>
    <div class="input-row">
      <input type="url" id="url" placeholder="https://example.com">
      <button id="btn" onclick="audit()">Analyze</button>
    </div>
    <div id="status" class="status"></div>
    <div id="results" class="results">
      <div class="score-card">
        <div class="dial">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle class="dial-bg" cx="70" cy="70" r="60"/>
            <circle class="dial-progress" id="dial" cx="70" cy="70" r="60" stroke-dasharray="377" stroke-dashoffset="377"/>
          </svg>
          <div class="dial-text">
            <span class="dial-score" id="score">0</span>
            <span class="dial-label">GEO Score</span>
          </div>
        </div>
        <div class="score-info">
          <h2 id="readiness">Analyzing...</h2>
          <div class="score-url" id="siteDisplay"></div>
        </div>
      </div>
      <div class="section">
        <div class="top3-header">
          <span class="top3-icon">⚠</span> Top Priority Issues
        </div>
        <div id="top3"></div>
      </div>
      <div class="section">
        <div class="section-header" onclick="toggle('critical')">
          <span class="section-title">🔴 Critical <span class="section-count" id="criticalCount">0</span></span>
          <span class="chevron" id="criticalChevron">▼</span>
        </div>
        <div class="section-content" id="criticalContent"></div>
      </div>
      <div class="section">
        <div class="section-header" onclick="toggle('high')">
          <span class="section-title">🟠 High <span class="section-count" id="highCount">0</span></span>
          <span class="chevron" id="highChevron">▼</span>
        </div>
        <div class="section-content" id="highContent"></div>
      </div>
      <div class="section">
        <div class="section-header" onclick="toggle('medium')">
          <span class="section-title">🔵 Medium <span class="section-count" id="mediumCount">0</span></span>
          <span class="chevron" id="mediumChevron">▼</span>
        </div>
        <div class="section-content" id="mediumContent"></div>
      </div>
      <div class="section">
        <div class="section-header" onclick="toggle('low')">
          <span class="section-title">⚪ Low <span class="section-count" id="lowCount">0</span></span>
          <span class="chevron" id="lowChevron">▼</span>
        </div>
        <div class="section-content" id="lowContent"></div>
      </div>
    </div>
  </div>
  <script>
    function toggle(id) {
      document.getElementById(id + 'Content').classList.toggle('show');
      document.getElementById(id + 'Chevron').classList.toggle('open');
    }
    function scoreColor(s) { return s >= 70 ? '#10b981' : s >= 40 ? '#f59e0b' : '#ef4444'; }
    function renderFinding(f) {
      return '<div class="finding ' + f.priority + '">' +
        '<div class="finding-header"><span class="finding-title">' + f.title + '</span>' +
        '<span class="priority-badge ' + f.priority + '">' + f.priority + '</span></div>' +
        '<div class="finding-why">' + f.why_it_matters + '</div>' +
        '<div class="finding-evidence">' + f.evidence + '</div>' +
        '<div class="finding-fix"><strong>Fix:</strong> ' + f.fix_recommendation + '</div></div>';
    }
    async function audit() {
      const url = document.getElementById('url').value.trim();
      if (!url) return alert('Enter a URL');
      const btn = document.getElementById('btn');
      const status = document.getElementById('status');
      const results = document.getElementById('results');
      btn.disabled = true;
      status.className = 'status';
      status.textContent = 'Analyzing...';
      results.classList.remove('show');
      try {
        const r = await fetch('/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteUrl: url })
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        const dial = document.getElementById('dial');
        const offset = 377 - (d.overallScore / 100) * 377;
        dial.style.stroke = scoreColor(d.overallScore);
        dial.style.strokeDashoffset = offset;
        document.getElementById('score').textContent = d.overallScore;
        document.getElementById('score').style.color = scoreColor(d.overallScore);
        const readiness = d.overallScore >= 70 ? 'Strong' : d.overallScore >= 40 ? 'Needs Work' : 'Not Ready';
        const badgeClass = d.overallScore >= 70 ? 'badge-strong' : d.overallScore >= 40 ? 'badge-work' : 'badge-not';
        document.getElementById('readiness').innerHTML = '<span class="badge ' + badgeClass + '">' + readiness + '</span>';
        document.getElementById('siteDisplay').textContent = d.siteUrl;
        document.getElementById('top3').innerHTML = d.top3.map(renderFinding).join('');
        ['critical', 'high', 'medium', 'low'].forEach(p => {
          document.getElementById(p + 'Count').textContent = d.groups[p].length;
          document.getElementById(p + 'Content').innerHTML = d.groups[p].map(renderFinding).join('') || '<p style="color:#64748b;padding:1rem;">None</p>';
        });
        status.textContent = '';
        results.classList.add('show');
      } catch (e) {
        status.className = 'status error';
        status.textContent = 'Error: ' + e.message;
      }
      btn.disabled = false;
    }
    document.getElementById('url').addEventListener('keypress', e => { if (e.key === 'Enter') audit(); });
  </script>
</body>
</html>`;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // GET / → HTML UI
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(HTML_UI, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // POST /run → JSON audit
    if (request.method === 'POST' && url.pathname === '/run') {
      try {
        const body = await request.json() as { siteUrl?: string };
        if (!body.siteUrl) {
          return new Response(JSON.stringify({ error: 'siteUrl required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const result = await runAudit(body.siteUrl);
        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Audit failed';
        return new Response(JSON.stringify({ error: msg }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // GET /health
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
