# Nico GEO Content Maker - Project Context Document

> **Purpose**: This document provides complete context for Claude to understand the project architecture, current state, and assist with planning future development.

---

## Executive Summary

**Nico GEO Content Maker** is a Generative Engine Optimization (GEO) content generation and audit platform. It transforms structured business data into AI-optimized content packages and audits existing websites for GEO readiness.

**Key Characteristics**:
- Framework-agnostic (works with any website: Astro, Next.js, Hugo, static)
- Deterministic output (fixed execution order, reproducible results)
- Anti-hallucination enforcement (all output derived solely from input data)
- Deployed as Cloudflare Workers with KV storage and Durable Objects

**Current State**: Production-ready with active development. Core features complete.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE WORKERS                          │
├─────────────────────────────────────────────────────────────────────┤
│  /worker/worker.ts          │  /src/index.ts                        │
│  Main API (2,092 lines)     │  Audit Engine                         │
│  - POST /run                │  - Real HTML crawling                 │
│  - POST /review/create      │  - 36+ audit rules                    │
│  - GET /review/{id}         │  - Visual HTML report                 │
│  - POST /review/{id}/approve│                                       │
│  - POST /review/{id}/apply  │                                       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           CORE MODULES                              │
├─────────────────┬─────────────────┬─────────────────┬───────────────┤
│   /generators   │   /analyze      │  /intelligence  │  /writeback   │
├─────────────────┼─────────────────┼─────────────────┼───────────────┤
│ titleMeta       │ geoGapAnalyzer  │ opportunityScorer│ githubClient │
│ answerCapsule   │ improvementPlan │ actionQueue     │ patchApplier  │
│ serviceDesc     │                 │ gscSnapshot.*   │ pathContract  │
│ faq             │                 │                 │               │
│ schema          │                 │                 │               │
└─────────────────┴─────────────────┴─────────────────┴───────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          SUPPORTING LAYERS                          │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│    /inputs      │   /contracts    │         /adapters               │
├─────────────────┼─────────────────┼─────────────────────────────────┤
│ BusinessInput   │ GEOOutputContract│ json.adapter.ts                │
│ schema          │ (output shape)  │ markdown.adapter.ts             │
│                 │                 │ html.adapter.ts                 │
└─────────────────┴─────────────────┴─────────────────────────────────┘
```

---

## Directory Structure

```
/Nico-Geo-Content-Maker
├── /src
│   └── index.ts              # Audit Engine Worker (36+ rules, HTML report)
│
├── /worker
│   ├── worker.ts             # Main API Worker (generate/audit/improve modes)
│   ├── auth.ts               # API key validation (KV-backed)
│   ├── rateLimit.ts          # Rate limiting logic (free/pro plans)
│   ├── doRateLimiter.ts      # Durable Object for rate limit state
│   ├── reviewSessions.ts     # Review session lifecycle management
│   ├── observability.ts      # Request tracing, structured logging
│   ├── errors.ts             # Centralized error codes
│   └── types.ts              # API TypeScript interfaces
│
├── /core
│   ├── /generators           # Content generation modules
│   │   ├── titleMeta.generator.ts
│   │   ├── answerCapsule.generator.ts
│   │   ├── serviceDescription.generator.ts
│   │   ├── faq.generator.ts
│   │   └── schema.generator.ts
│   │
│   ├── /pipeline
│   │   └── geoPipeline.ts    # Orchestrates all generators
│   │
│   ├── /analyze
│   │   ├── geoGapAnalyzer.ts      # Analyzes crawled content for GEO gaps
│   │   └── improvementPlanner.ts  # Generates patch-ready improvements
│   │
│   ├── /intelligence
│   │   ├── opportunityScorer.ts   # GEO gaps + GSC signals scoring
│   │   ├── actionQueue.ts         # Ranks pages by impact potential
│   │   ├── gscSnapshot.types.ts   # GSC data types
│   │   └── gscSnapshot.normalise.ts
│   │
│   ├── /ingest
│   │   ├── siteCrawler.ts         # Multi-page HTML crawling
│   │   └── sitemapDiscovery.ts    # Sitemap parsing
│   │
│   ├── /writeback
│   │   ├── githubClient.ts        # GitHub API integration
│   │   ├── patchApplier.ts        # Apply code patches to repos
│   │   └── pathContract.ts        # URL-to-filepath mapping
│   │
│   └── /rules
│       ├── antiHallucination.ts   # No-fabrication enforcement
│       └── businessInput.validator.ts
│
├── /inputs
│   ├── business.schema.ts    # Canonical input schema (TypeScript)
│   └── example.business.json # Sample input data
│
├── /contracts
│   └── output.contract.ts    # Output structure definition
│
├── /adapters
│   ├── json.adapter.ts       # JSON output (source of truth)
│   ├── markdown.adapter.ts   # Human-readable markdown
│   └── html.adapter.ts       # HTML fragments
│
├── /scripts
│   ├── runGeoPipeline.ts     # CLI runner for local generation
│   ├── ciSmoke.ts            # Offline validation tests
│   └── testOpportunityScoring.ts
│
├── /outputs                  # Generated output files
├── wrangler.toml             # Cloudflare Workers config
└── package.json
```

---

## Input Schema (BusinessInput)

The canonical input schema that drives all content generation:

```typescript
interface BusinessInput {
  business: {
    name: string;           // REQUIRED
    legalName?: string;
    website?: string;
    domain?: string;
  };

  location: {
    primaryCity: string;    // REQUIRED
    region?: string;
    country: string;        // REQUIRED
    serviceAreas: string[]; // REQUIRED (at least one)
  };

  contact: {
    phone?: string;
    email?: string;
  };

  services: {
    primary: string[];      // REQUIRED (at least one)
    secondary?: string[];
  };

  credentials?: {
    yearsOperating?: number;
    licenses?: string[];
    insurance?: string;
    certifications?: string[];
  };

  proof?: {
    reviewCount?: number;
    averageRating?: number;
    testimonialsAvailable?: boolean;
    caseStudiesAvailable?: boolean;
  };

  operations?: {
    operatingHours?: string;
    emergencyService?: boolean;
  };

  constraints: {
    noHallucinations: true;  // REQUIRED - must be true
    allowedSources?: string[];
  };
}
```

---

## Output Contract (GEOOutputContract)

The canonical output structure produced by the generation pipeline:

```typescript
interface GEOOutputContract {
  metadata: {
    generatedAt: string;
    businessName: string;
    pipelineVersion: string;
  };

  titleMeta: {
    title: string;
    metaDescription: string;
    ogTitle?: string;
    ogDescription?: string;
    sources: string[];
  };

  answerCapsule: {
    capsule: string;
    structuredAnswer: {
      entity: string;
      location: string;
      primaryOffering: string;
      proofPoint?: string;
    };
    sources: string[];
  };

  serviceDescriptions: {
    services: ServiceDescriptionItem[];
    summary: { totalServices, primaryCount, secondaryCount };
    sources: string[];
  };

  faq: {
    items: FAQItem[];
    schemaReady: FAQItem[];
    sources: string[];
  };

  schema: {
    localBusiness: LocalBusinessSchemaContract;
    jsonLd: string;
    validationNotes: string[];
    sources: string[];
  };

  allSources: string[];
}
```

---

## API Endpoints

### Main Worker (`/worker/worker.ts`)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/run` | POST | Required | Main endpoint - generate/audit/improve modes |
| `/review/create` | POST | Required | Create review session for improvements |
| `/review/{id}` | GET | Required | Get session details and diff previews |
| `/review/{id}/approve` | POST | Pro only | Approve session for write-back |
| `/review/{id}/apply` | POST | Pro only | Apply changes to GitHub |
| `/health` | GET | None | Health check |
| `/version` | GET | None | Version info |

### Request Modes (POST /run)

1. **`generate`** - Generate GEO content from BusinessInput
2. **`audit`** - Audit a website for GEO readiness
3. **`improve`** - Generate improvement plans for a site

### Rate Limits

| Plan | Daily | Per Minute |
|------|-------|------------|
| free | 20 | 2 |
| pro | 500 | 30 |

---

## Audit Engine (`/src/index.ts`)

### Signal Extraction (50+ signals per page)

```typescript
interface PageSignals {
  // Basic SEO
  url, title, metaDescription, h1Count, h1Text
  h2s[], h3s[], h4Count, h5Count, h6Count
  wordCount, bodyText

  // Links
  internalLinks[], internalLinkCount, externalLinkCount
  anchorTexts[]

  // Images
  imageCount, imagesWithAlt, imagesMissingAlt[]

  // Schema.org
  jsonLdTypes[], hasLocalBusinessSchema, hasOrganizationSchema
  hasServiceSchema, schemaDetails[]

  // Geography
  hasGeoKeywords, geoTermsFound[]
  hasServiceKeywords, serviceTermsFound[]

  // Technical
  robotsNoindex, canonicalUrl

  // NAP (Name, Address, Phone)
  hasPhone, phoneNumbers[], hasEmail, emails[]
  hasAddress, addressSignals[], napConsistent

  // Page Type
  isServicePage, isLocationPage
}
```

### Audit Rules (36+ rules across severity levels)

**Critical (×20 weight)**:
- Missing/empty title tag
- Missing H1
- Homepage has noindex

**High (×12 weight)**:
- Title too short (<30 chars) or too long (>60 chars)
- Missing meta description
- Meta description length issues
- Duplicate H1 tags
- Missing LocalBusiness schema
- Missing Organization schema
- No phone number on homepage
- No address signals
- Missing geo keywords in content

**Medium (×6 weight)**:
- Service pages missing Service schema
- Images missing alt text
- Thin content (<300 words)
- Missing H2 structure
- No internal links
- No service area keywords
- H1 missing geo modifier
- H1 missing service modifier

**Low (×2 weight) - Opportunities**:
- Short title (could be longer)
- Short meta description (could be longer)
- Low word count (could add more)
- Few images (could add more)
- Schema exists but could be richer
- Some images missing alt (not all)

### Scoring Formula

```
Score = 100 - Σ(issue_weight)
Where weights: critical=20, high=12, medium=6, low=2
Minimum score: 0
```

---

## Key Design Principles

### 1. Anti-Hallucination Enforcement
Every output statement must derive from input data. When data is missing, the system uses `[ADD FACT]` placeholders instead of fabricating information.

```typescript
// From antiHallucination.ts
constraints: {
  noHallucinations: true;  // Must be true or validation fails
}
```

### 2. Deterministic Execution
- Fixed generator order in pipeline
- No randomization
- Same input always produces same output
- Reproducible for testing and debugging

### 3. Single Source of Truth
- `BusinessInput` schema constrains all generation
- `GEOOutputContract` defines output structure
- No implicit data creation

### 4. Evidence-Based Auditing
Every finding includes:
- **Evidence**: What was found (or not found)
- **Impact**: Why it matters for GEO
- **Recommendation**: Specific fix action

---

## What's Been Completed

### Core Generation Pipeline ✅
- 5 modular generators (title/meta, answer capsules, service descriptions, FAQs, schema.org)
- Input validation with anti-hallucination enforcement
- Multiple output formats (JSON, Markdown, HTML)

### Site Analysis ✅
- Multi-page HTML crawling (homepage + 3 additional pages)
- 50+ signal extraction per page
- GEO gap analysis comparing content to optimal patterns

### Audit Engine ✅
- 36+ rules across 4 severity levels
- Evidence-based findings with impact and recommendations
- Visual HTML report with priority grouping
- Opportunity detection for weak-but-passing signals

### Intelligence Layer ✅
- Opportunity scoring combining GEO gaps + GSC visibility
- Action queue ranking pages by impact potential
- GSC data normalization

### Cloudflare Worker API ✅
- REST endpoints with authentication
- Rate limiting (free/pro plans) via Durable Objects
- Request tracing and structured logging
- Review session workflow

### Write-back Integration ✅
- GitHub API client for reading repos
- Patch applier for file modifications
- Path contract mapping URLs to file paths
- Review session lifecycle (create → review → approve → apply)

---

## Recent Development History

| Commit | Feature |
|--------|---------|
| d15c383 | Added "Opportunity" findings for weak-but-passing signals |
| 23fa849 | Added H1 geo + service modifier checks |
| 37207c4 | Made audit rules fire more liberally (better coverage) |
| 039f289 | Expanded to 36 audit rules |
| 5767ef3 | Implemented full HTML-based audit engine |
| f15eec0 | Completed production GEO audit engine |
| e1739e7 | Production audit with HTMLRewriter and visual report |

---

## Known Gaps / Future Opportunities

### Not Yet Implemented

1. **Review Session UI**
   - API is complete, but no frontend for users to review/approve changes
   - Currently API-only workflow

2. **GSC Integration Refinement**
   - Basic GSC data normalization exists
   - Could be more sophisticated (trend analysis, keyword clustering)

3. **Industry-Specific Templates**
   - Current rules are generic
   - Could add domain-specific templates (plumbing, HVAC, legal, medical, etc.)

4. **Multi-Language Support**
   - Currently English-only for keyword detection
   - Geo terms and service terms are hardcoded

5. **Batch Processing**
   - Single-site processing only
   - No bulk audit capability

6. **Custom Rule Configuration**
   - Rules are hardcoded
   - No user-configurable rule weights or toggles

7. **Historical Tracking**
   - No audit history storage
   - Can't show improvement over time

8. **Expanded Schema Support**
   - Currently checks LocalBusiness, Organization, Service
   - Could add Event, Product, FAQ, HowTo schema detection

---

## Running the Project

### Local Development

```bash
# Install dependencies
npm install

# Run content generation pipeline
npm run run:geo

# Run smoke tests (offline)
npm run test:smoke

# Start local Cloudflare Worker
npm run dev

# Deploy to Cloudflare
npm run deploy
```

### Required Cloudflare Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `NICO_GEO_KEYS` | KV Namespace | API key storage |
| `NICO_GEO_SESSIONS` | KV Namespace | Review session storage |
| `RATE_LIMITER` | Durable Object | Rate limit state |

---

## Codebase Statistics

- **Total TypeScript**: ~14,300 lines
- **Main Worker**: 2,092 lines
- **Audit Engine**: ~900 lines
- **Total Commits**: 51
- **Dependencies**: Minimal (ts-node, wrangler, typescript)

---

## Questions for Planning

When helping plan next steps, consider:

1. **What is the primary user persona?** (Agency? Individual business owner? Developer?)
2. **What is the deployment model?** (SaaS? Self-hosted? Both?)
3. **What integrations are highest priority?** (GSC API? Analytics? CMS platforms?)
4. **Should the audit UI be a separate frontend or embedded in existing sites?**
5. **Are there specific industries to prioritize for templates?**

---

*Document generated for Claude context. Last updated based on commit fda5b6f.*
