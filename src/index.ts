/**
 * Nico GEO Audit Worker
 * Production-ready SEO audit for AI search visibility
 */

interface Issue {
  id: string;
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  impact: string;
  evidence: string;
  recommendation: string;
  weight: number;
}

interface TopIssue {
  title: string;
  impact: string;
  recommendation: string;
}

interface AuditResponse {
  siteUrl: string;
  score: number;
  topIssues: TopIssue[];
  issues: {
    critical: Issue[];
    high: Issue[];
    medium: Issue[];
    low: Issue[];
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

const WEIGHTS = { critical: 25, high: 15, medium: 8, low: 3 };

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

  private tag = '';
  private text = '';
  private host = '';

  constructor(baseUrl: string) {
    try { this.host = new URL(baseUrl).hostname; } catch {}
  }

  titleHandler = {
    element: () => { this.tag = 'title'; this.text = ''; },
    text: ({ text }: { text: string }) => { if (this.tag === 'title') this.text += text; },
  };

  h1Handler = {
    element: () => { this.tag = 'h1'; this.text = ''; },
    text: ({ text }: { text: string }) => { if (this.tag === 'h1') this.text += text; },
  };

  h2Handler = {
    element: () => { this.tag = 'h2'; this.text = ''; },
    text: ({ text }: { text: string }) => { if (this.tag === 'h2') this.text += text; },
  };

  h3Handler = {
    element: () => { this.tag = 'h3'; this.text = ''; },
    text: ({ text }: { text: string }) => { if (this.tag === 'h3') this.text += text; },
  };

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
      if (href.startsWith('/') || href.startsWith('./') || href.includes(this.host)) {
        this.data.internalLinks.push(href);
      }
      this.tag = 'a';
      this.text = '';
    },
    text: ({ text }: { text: string }) => { if (this.tag === 'a') this.text += text; },
  };

  scriptHandler = {
    element: (el: any) => {
      if ((el.getAttribute('type') || '') === 'application/ld+json') {
        this.tag = 'jsonld';
        this.text = '';
      }
    },
    text: ({ text }: { text: string }) => { if (this.tag === 'jsonld') this.text += text; },
  };

  bodyHandler = {
    text: ({ text }: { text: string }) => { this.data.bodyText += text + ' '; },
  };

  onTitleEnd() { this.data.title = this.text.trim(); this.tag = ''; }
  onH1End() { if (!this.data.h1) this.data.h1 = this.text.trim(); this.tag = ''; }
  onH2End() { if (this.text.trim()) this.data.h2s.push(this.text.trim()); this.tag = ''; }
  onH3End() { if (this.text.trim()) this.data.h3s.push(this.text.trim()); this.tag = ''; }
  onLinkEnd() { if (this.text.trim()) this.data.anchorTexts.push(this.text.trim()); this.tag = ''; }

  onScriptEnd() {
    if (this.tag === 'jsonld') {
      const c = this.text.toLowerCase();
      if (c.includes('localbusiness') || c.includes('plumber') || c.includes('electrician') ||
          c.includes('contractor') || c.includes('professionalservice')) {
        this.data.hasLocalBusinessSchema = true;
      }
      const types = c.match(/"@type"\s*:\s*"([^"]+)"/g);
      if (types) types.forEach(m => {
        const t = m.match(/"@type"\s*:\s*"([^"]+)"/);
        if (t) this.data.jsonLdTypes.push(t[1]);
      });
    }
    this.tag = '';
  }

  finalize() {
    const clean = this.data.bodyText.replace(/\s+/g, ' ').trim();
    this.data.wordCount = clean.split(/\s+/).filter(w => w.length > 2).length;
    const check = (this.data.title + ' ' + this.data.h1 + ' ' + this.data.metaDescription).toLowerCase();
    this.data.hasGeoModifiers = GEO_TERMS.some(t => check.includes(t));
  }
}

function analyze(data: PageData, siteUrl: string): AuditResponse {
  const all: Issue[] = [];
  let score = 100;

  if (!data.title || data.title.length < 10) {
    all.push({ id: 'missing-title', title: 'Missing or Invalid Page Title', priority: 'critical',
      impact: 'Search engines and AI use the title as the primary identifier. Without it, you cannot rank.',
      evidence: data.title ? `"${data.title}" (${data.title.length} chars)` : 'No <title> found',
      recommendation: 'Add a 50-60 character title with your service and location.',
      weight: WEIGHTS.critical });
    score -= WEIGHTS.critical;
  }

  if (!data.h1) {
    all.push({ id: 'missing-h1', title: 'Missing H1 Heading', priority: 'critical',
      impact: 'The H1 is the most important heading. AI engines use it to understand the page topic.',
      evidence: 'No <h1> tag found',
      recommendation: 'Add a single H1 stating your primary service and location.',
      weight: WEIGHTS.critical });
    score -= WEIGHTS.critical;
  }

  if (data.wordCount < 300) {
    all.push({ id: 'thin-content', title: 'Critically Thin Content', priority: 'critical',
      impact: 'AI engines need substantial content to cite. Pages under 300 words rarely rank.',
      evidence: `${data.wordCount} words (minimum: 500)`,
      recommendation: 'Expand to 800+ words with services, FAQs, and local info.',
      weight: WEIGHTS.critical });
    score -= WEIGHTS.critical;
  } else if (data.wordCount < 500) {
    all.push({ id: 'low-content', title: 'Limited Content Depth', priority: 'high',
      impact: 'Comprehensive content outperforms thin pages.',
      evidence: `${data.wordCount} words (recommended: 800+)`,
      recommendation: 'Add service details, FAQs, and expertise sections.',
      weight: WEIGHTS.high });
    score -= WEIGHTS.high;
  }

  if (!data.metaDescription || data.metaDescription.length < 50) {
    all.push({ id: 'missing-meta', title: 'Missing Meta Description', priority: 'high',
      impact: 'Meta descriptions influence click-through and help AI understand intent.',
      evidence: data.metaDescription ? `${data.metaDescription.length} chars` : 'Not found',
      recommendation: 'Write a 150-160 char description with service, location, CTA.',
      weight: WEIGHTS.high });
    score -= WEIGHTS.high;
  }

  if (!data.hasLocalBusinessSchema) {
    all.push({ id: 'no-schema', title: 'Missing LocalBusiness Schema', priority: 'high',
      impact: 'Structured data helps AI understand your business type and location.',
      evidence: data.jsonLdTypes.length ? `Found: ${data.jsonLdTypes.join(', ')}` : 'No schema',
      recommendation: 'Add JSON-LD LocalBusiness with name, address, phone, services.',
      weight: WEIGHTS.high });
    score -= WEIGHTS.high;
  }

  if (!data.hasGeoModifiers) {
    all.push({ id: 'no-geo', title: 'No Geographic Targeting', priority: 'high',
      impact: 'Local businesses must signal service area. AI cannot recommend you without location.',
      evidence: 'No location terms in title, H1, or meta',
      recommendation: 'Add city/area to title and H1: "Emergency Plumber in North London"',
      weight: WEIGHTS.high });
    score -= WEIGHTS.high;
  }

  if (data.internalLinks.length < 5) {
    all.push({ id: 'weak-links', title: 'Weak Internal Linking', priority: 'medium',
      impact: 'Internal links distribute authority and help AI understand structure.',
      evidence: `${data.internalLinks.length} internal links found`,
      recommendation: 'Add 10+ links to services, areas, about, contact.',
      weight: WEIGHTS.medium });
    score -= WEIGHTS.medium;
  }

  const anchors = new Map<string, number>();
  data.anchorTexts.forEach(a => {
    const l = a.toLowerCase().trim();
    if (l.length > 2) anchors.set(l, (anchors.get(l) || 0) + 1);
  });
  const dupes = [...anchors.entries()].filter(([_, c]) => c > 3);
  if (dupes.length) {
    all.push({ id: 'dupe-anchors', title: 'Duplicate Anchor Text', priority: 'medium',
      impact: 'Repeated anchors look spammy and waste linking power.',
      evidence: dupes.slice(0, 3).map(([t, c]) => `"${t}" (${c}x)`).join(', '),
      recommendation: 'Vary anchor text to be descriptive.',
      weight: WEIGHTS.medium });
    score -= WEIGHTS.medium;
  }

  if (data.h1 && !data.h2s.length) {
    all.push({ id: 'flat-headings', title: 'Flat Heading Structure', priority: 'medium',
      impact: 'H1→H2→H3 hierarchy helps AI parse sections.',
      evidence: 'H1 present but no H2s',
      recommendation: 'Add H2 subheadings for each service/topic.',
      weight: WEIGHTS.medium });
    score -= WEIGHTS.medium;
  }

  if (data.title && (data.title.length < 30 || data.title.length > 65)) {
    all.push({ id: 'title-length', title: 'Suboptimal Title Length', priority: 'low',
      impact: 'Titles 50-60 chars display fully in search results.',
      evidence: `${data.title.length} characters`,
      recommendation: 'Adjust to 50-60 characters.',
      weight: WEIGHTS.low });
    score -= WEIGHTS.low;
  }

  if (data.metaDescription && (data.metaDescription.length < 120 || data.metaDescription.length > 160)) {
    all.push({ id: 'meta-length', title: 'Suboptimal Meta Description Length', priority: 'low',
      impact: 'Descriptions 150-160 chars maximize SERP space.',
      evidence: `${data.metaDescription.length} characters`,
      recommendation: 'Adjust to 150-160 characters.',
      weight: WEIGHTS.low });
    score -= WEIGHTS.low;
  }

  score = Math.max(0, Math.min(100, score));
  const sorted = [...all].sort((a, b) => b.weight - a.weight);

  return {
    siteUrl,
    score,
    topIssues: sorted.slice(0, 3).map(i => ({ title: i.title, impact: i.impact, recommendation: i.recommendation })),
    issues: {
      critical: all.filter(i => i.priority === 'critical'),
      high: all.filter(i => i.priority === 'high'),
      medium: all.filter(i => i.priority === 'medium'),
      low: all.filter(i => i.priority === 'low'),
    },
  };
}

async function runAudit(siteUrl: string): Promise<AuditResponse> {
  if (!siteUrl.startsWith('http')) siteUrl = 'https://' + siteUrl;

  const res = await fetch(siteUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NicoGEOBot/1.0)', 'Accept': 'text/html' },
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const parser = new HTMLParser(siteUrl);
  let titleDone = false, h1Done = false, h2Done = false, h3Done = false, aDone = false, scriptDone = false;

  const rewriter = new HTMLRewriter()
    .on('title', {
      element: parser.titleHandler.element,
      text: parser.titleHandler.text,
    })
    .on('h1', {
      element: parser.h1Handler.element,
      text: parser.h1Handler.text,
    })
    .on('h2', {
      element: parser.h2Handler.element,
      text: parser.h2Handler.text,
    })
    .on('h3', {
      element: parser.h3Handler.element,
      text: parser.h3Handler.text,
    })
    .on('meta', parser.metaHandler)
    .on('a', {
      element: parser.linkHandler.element,
      text: parser.linkHandler.text,
    })
    .on('script[type="application/ld+json"]', {
      element: parser.scriptHandler.element,
      text: parser.scriptHandler.text,
    })
    .on('body *', parser.bodyHandler);

  await rewriter.transform(res).text();
  parser.finalize();

  return analyze(parser.data, siteUrl);
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GEO Audit</title>
  <style>
    :root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#f1f5f9;--muted:#94a3b8;--critical:#ef4444;--high:#f59e0b;--medium:#3b82f6;--low:#64748b;--success:#10b981;--purple:#8b5cf6}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.6}
    .c{max-width:900px;margin:0 auto;padding:2rem 1rem}
    h1{font-size:2rem;text-align:center;margin-bottom:.5rem;background:linear-gradient(90deg,var(--purple),var(--critical));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .sub{text-align:center;color:var(--muted);margin-bottom:2rem}
    .row{display:flex;gap:.75rem;margin-bottom:2rem}
    input{flex:1;padding:1rem;font-size:1rem;background:var(--card);border:1px solid var(--border);border-radius:.5rem;color:var(--text);outline:none}
    input:focus{border-color:var(--purple)}
    button{padding:1rem 2rem;font-size:1rem;font-weight:600;background:linear-gradient(90deg,var(--purple),#6366f1);border:none;border-radius:.5rem;color:#fff;cursor:pointer}
    button:disabled{opacity:.5}
    .st{text-align:center;padding:1rem;color:var(--muted)}
    .err{color:var(--critical);background:rgba(239,68,68,.1);border-radius:.5rem}
    .res{display:none}
    .res.show{display:block}
    .sc{display:flex;align-items:center;gap:2rem;background:var(--card);border:1px solid var(--border);border-radius:1rem;padding:2rem;margin-bottom:2rem}
    .dial{position:relative;width:140px;height:140px;flex-shrink:0}
    .dial svg{transform:rotate(-90deg)}
    .dial-bg{fill:none;stroke:var(--border);stroke-width:10}
    .dial-p{fill:none;stroke-width:10;stroke-linecap:round;transition:stroke-dashoffset .8s}
    .dial-t{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
    .dial-v{font-size:2.5rem;font-weight:700}
    .dial-l{font-size:.75rem;color:var(--muted)}
    .info h2{font-size:1.25rem;margin-bottom:.5rem}
    .url{color:var(--muted);font-size:.875rem;word-break:break-all}
    .badge{display:inline-block;padding:.25rem .75rem;border-radius:1rem;font-size:.75rem;font-weight:600;margin-top:.5rem}
    .b-s{background:var(--success)}.b-w{background:var(--high)}.b-n{background:var(--critical)}
    .sec{margin-bottom:1.5rem}
    .sec-h{font-size:1.25rem;margin-bottom:1rem;display:flex;align-items:center;gap:.5rem}
    .card{background:var(--card);border:1px solid var(--border);border-left:4px solid;border-radius:.5rem;padding:1.25rem;margin-bottom:1rem}
    .card.critical{border-left-color:var(--critical)}.card.high{border-left-color:var(--high)}.card.medium{border-left-color:var(--medium)}.card.low{border-left-color:var(--low)}
    .card-h{display:flex;justify-content:space-between;align-items:start;margin-bottom:.75rem}
    .card-t{font-weight:600}
    .pri{padding:.2rem .6rem;border-radius:1rem;font-size:.7rem;font-weight:600;text-transform:uppercase}
    .pri.critical{background:rgba(239,68,68,.2);color:var(--critical)}
    .pri.high{background:rgba(245,158,11,.2);color:var(--high)}
    .pri.medium{background:rgba(59,130,246,.2);color:var(--medium)}
    .pri.low{background:rgba(100,116,139,.2);color:var(--low)}
    .card-i{color:var(--muted);font-size:.9rem;margin-bottom:.75rem}
    .card-e{background:rgba(0,0,0,.2);padding:.75rem;border-radius:.25rem;font-size:.85rem;margin-bottom:.75rem;font-family:monospace}
    .card-f{background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.2);padding:.75rem;border-radius:.25rem;font-size:.875rem}
    .card-f strong{color:var(--success)}
    details{margin-bottom:1rem}
    summary{display:flex;justify-content:space-between;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:.5rem;padding:1rem;cursor:pointer;list-style:none}
    summary::-webkit-details-marker{display:none}
    summary h3{font-size:1rem;display:flex;align-items:center;gap:.5rem}
    .cnt{background:var(--border);padding:.125rem .5rem;border-radius:.25rem;font-size:.75rem}
    details[open] summary{border-radius:.5rem .5rem 0 0}
    .det{padding:1rem;background:var(--card);border:1px solid var(--border);border-top:none;border-radius:0 0 .5rem .5rem}
  </style>
</head>
<body>
  <div class="c">
    <h1>GEO Audit</h1>
    <p class="sub">SEO analysis for AI search visibility</p>
    <div class="row">
      <input type="url" id="url" placeholder="https://example.com">
      <button id="btn">Analyze</button>
    </div>
    <div id="st" class="st"></div>
    <div id="res" class="res">
      <div class="sc">
        <div class="dial">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle class="dial-bg" cx="70" cy="70" r="60"/>
            <circle class="dial-p" id="dial" cx="70" cy="70" r="60" stroke-dasharray="377" stroke-dashoffset="377"/>
          </svg>
          <div class="dial-t">
            <span class="dial-v" id="score">0</span>
            <span class="dial-l">GEO Score</span>
          </div>
        </div>
        <div class="info">
          <h2 id="ready">Analyzing...</h2>
          <div class="url" id="site"></div>
        </div>
      </div>
      <div class="sec">
        <div class="sec-h">⚠️ Top 3 Priority Issues</div>
        <div id="top3"></div>
      </div>
      <details>
        <summary><h3>🔴 Critical <span class="cnt" id="cCnt">0</span></h3></summary>
        <div class="det" id="cList"></div>
      </details>
      <details>
        <summary><h3>🟠 High <span class="cnt" id="hCnt">0</span></h3></summary>
        <div class="det" id="hList"></div>
      </details>
      <details>
        <summary><h3>🔵 Medium <span class="cnt" id="mCnt">0</span></h3></summary>
        <div class="det" id="mList"></div>
      </details>
      <details>
        <summary><h3>⚪ Low <span class="cnt" id="lCnt">0</span></h3></summary>
        <div class="det" id="lList"></div>
      </details>
    </div>
  </div>
  <script>
    const $ = id => document.getElementById(id);
    const col = s => s >= 70 ? '#10b981' : s >= 40 ? '#f59e0b' : '#ef4444';
    const topCard = i => '<div class="card critical"><div class="card-h"><span class="card-t">' + i.title + '</span></div><div class="card-i">' + i.impact + '</div><div class="card-f"><strong>Fix:</strong> ' + i.recommendation + '</div></div>';
    const issueCard = i => '<div class="card ' + i.priority + '"><div class="card-h"><span class="card-t">' + i.title + '</span><span class="pri ' + i.priority + '">' + i.priority + '</span></div><div class="card-i">' + i.impact + '</div><div class="card-e">' + i.evidence + '</div><div class="card-f"><strong>Fix:</strong> ' + i.recommendation + '</div></div>';
    async function run() {
      const url = $('url').value.trim();
      if (!url) return alert('Enter a URL');
      $('btn').disabled = true;
      $('st').className = 'st';
      $('st').textContent = 'Analyzing...';
      $('res').classList.remove('show');
      try {
        const r = await fetch('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteUrl: url }) });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        const dial = $('dial');
        dial.style.stroke = col(d.score);
        dial.style.strokeDashoffset = 377 - (d.score / 100) * 377;
        $('score').textContent = d.score;
        $('score').style.color = col(d.score);
        const lbl = d.score >= 70 ? 'Strong' : d.score >= 40 ? 'Needs Work' : 'Not Ready';
        const cls = d.score >= 70 ? 'b-s' : d.score >= 40 ? 'b-w' : 'b-n';
        $('ready').innerHTML = '<span class="badge ' + cls + '">' + lbl + '</span>';
        $('site').textContent = d.siteUrl;
        $('top3').innerHTML = d.topIssues.map(topCard).join('');
        $('cCnt').textContent = d.issues.critical.length;
        $('hCnt').textContent = d.issues.high.length;
        $('mCnt').textContent = d.issues.medium.length;
        $('lCnt').textContent = d.issues.low.length;
        $('cList').innerHTML = d.issues.critical.map(issueCard).join('') || '<p style="color:#64748b">None</p>';
        $('hList').innerHTML = d.issues.high.map(issueCard).join('') || '<p style="color:#64748b">None</p>';
        $('mList').innerHTML = d.issues.medium.map(issueCard).join('') || '<p style="color:#64748b">None</p>';
        $('lList').innerHTML = d.issues.low.map(issueCard).join('') || '<p style="color:#64748b">None</p>';
        $('st').textContent = '';
        $('res').classList.add('show');
      } catch (e) {
        $('st').className = 'st err';
        $('st').textContent = 'Error: ' + e.message;
      }
      $('btn').disabled = false;
    }
    $('btn').onclick = run;
    $('url').onkeypress = e => { if (e.key === 'Enter') run(); };
  </script>
</body>
</html>`;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (request.method === 'POST' && url.pathname === '/run') {
      try {
        const body = await request.json() as { siteUrl?: string };
        if (!body.siteUrl) {
          return new Response(JSON.stringify({ error: 'siteUrl required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        const result = await runAudit(body.siteUrl);
        return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Audit failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  },
};
