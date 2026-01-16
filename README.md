# Nico GEO Content Maker

A generic GEO (Generative Engine Optimization) content generation engine. It transforms structured business data into optimized content packages suitable for AI-driven search results, featured snippets, and schema.org markup. The engine is framework-agnostic, deterministic, and enforces strict anti-hallucination rules to ensure all output is derived solely from provided input data.

## Input

The engine accepts a single JSON file conforming to the `BusinessInput` schema. Required fields:

- `business.name` - Business name (string)
- `location.primaryCity` - Primary city (string)
- `location.country` - Country (string)
- `location.serviceAreas` - Service areas (array of strings, at least one)
- `services.primary` - Primary services offered (array of strings, at least one)
- `constraints.noHallucinations` - Must be `true`

See `/inputs/business.schema.ts` for the complete schema definition.

Example input file: `/inputs/example.business.json`

## Output

The engine produces three output files:

- `example-output.json` - Canonical JSON output (source of truth)
- `example-output.md` - Markdown format for human review
- `example-output.html` - HTML fragments for web integration

Output includes: title/meta tags, answer capsules, service descriptions, FAQs, and schema.org JSON-LD.

## Usage

```bash
# Install dependencies
npm install

# Run the pipeline
npm run run:geo
```

The script reads from `/inputs/example.business.json` and writes to `/outputs/`.

To use custom input, replace or modify `example.business.json` with your business data.

## Cloudflare Worker API

The GEO engine is also available as a Cloudflare Worker API at `POST /run`.

### Authentication

All requests require an API key in the Authorization header:

```
Authorization: Bearer <your_api_key>
```

### Rate Limits

| Plan | Daily Limit | Burst (per minute) |
|------|-------------|-------------------|
| free | 20 requests | 2 requests |
| pro  | 500 requests | 30 requests |

### Plan Features

- **free**: Generate, audit, and improve modes (read-only)
- **pro**: All free features + write-back to GitHub repositories

### Local Development Setup

To run the Worker locally, you need to set up Cloudflare bindings:

#### 1. Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

#### 2. Create KV Namespace

```bash
# Create production namespace
wrangler kv:namespace create "NICO_GEO_KEYS"

# Create preview namespace for local dev
wrangler kv:namespace create "NICO_GEO_KEYS" --preview
```

Copy the returned namespace IDs and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "NICO_GEO_KEYS"
id = "<production_namespace_id>"
preview_id = "<preview_namespace_id>"
```

#### 3. Create a Test API Key

For local development, create a test key in your preview KV namespace:

```bash
# Generate a test key (example using openssl)
TEST_KEY=$(openssl rand -hex 16)
echo "Your test API key: $TEST_KEY"

# Create the key record JSON
KEY_RECORD='{"keyId":"test-dev-key","status":"active","plan":"pro","createdAt":"2024-01-01T00:00:00Z","notes":"Local development key"}'

# Store in KV (replace <preview_namespace_id> with your actual ID)
wrangler kv:key put --namespace-id=<preview_namespace_id> "api_key_$TEST_KEY" "$KEY_RECORD"
```

#### 4. Run Locally

```bash
wrangler dev
```

#### 5. Test the API

```bash
curl -X POST http://localhost:8787/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_KEY" \
  -d '{
    "mode": "generate",
    "businessInput": {
      "business": { "name": "Test Business" },
      "location": {
        "primaryCity": "Austin",
        "country": "USA",
        "serviceAreas": ["Austin", "Round Rock"]
      },
      "services": { "primary": ["Consulting"] },
      "constraints": { "noHallucinations": true }
    },
    "constraints": { "noHallucinations": true }
  }'
```

### API Response Format

Successful responses include usage information:

```json
{
  "status": "success",
  "mode": "generate",
  "summary": { ... },
  "results": { ... },
  "usage": {
    "keyId": "your-key-id",
    "plan": "free",
    "requestsToday": 5,
    "dailyLimit": 20,
    "minuteWindowCount": 1,
    "minuteWindowLimit": 2
  }
}
```

### Error Responses

All errors return structured JSON:

```json
{
  "status": "error",
  "errorCode": "DAILY_LIMIT_EXCEEDED",
  "message": "Daily rate limit exceeded. Please try again tomorrow.",
  "details": {
    "retryAfterSeconds": 3600,
    "usage": { ... }
  }
}
```

Error codes:
- `MISSING_AUTH` - No Authorization header (401)
- `INVALID_FORMAT` - Invalid Authorization header format (401)
- `INVALID_KEY` - API key not found (401)
- `KEY_DISABLED` - API key has been disabled (401)
- `DAILY_LIMIT_EXCEEDED` - Daily rate limit reached (429)
- `MINUTE_LIMIT_EXCEEDED` - Too many requests per minute (429)
- `PLAN_REQUIRED` - Feature requires higher plan (403)
- `VALIDATION_ERROR` - Request validation failed (400)
- `INTERNAL_ERROR` - Server error (500)

### Review Session API

Review sessions enable human review of improvement plans before write-back to GitHub. This is the recommended workflow for safe deployments.

#### Create Review Session

```bash
curl -X POST https://your-worker.workers.dev/review/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "mode": "improve",
    "siteUrl": "https://example.com",
    "constraints": { "noHallucinations": true },
    "targetRepo": {
      "owner": "your-org",
      "repo": "your-site",
      "branch": "main",
      "projectType": "astro-pages",
      "routeStrategy": "path-index"
    }
  }'
```

Response:

```json
{
  "status": "success",
  "sessionId": "abc12345-1234-4567-89ab-cdef01234567",
  "expiresAt": "2024-01-16T12:00:00.000Z",
  "summary": {
    "siteUrl": "https://example.com",
    "selectedTargets": ["/", "/services"],
    "plannedFilesCount": 3,
    "filesRequiringReview": 1
  }
}
```

#### Get Session Details

```bash
curl -X GET https://your-worker.workers.dev/review/{sessionId} \
  -H "Authorization: Bearer $API_KEY"
```

Returns session details including planned files, diff previews, and current status.

#### Approve Session (Pro Plan Required)

```bash
curl -X POST https://your-worker.workers.dev/review/{sessionId}/approve \
  -H "Authorization: Bearer $API_KEY"
```

Response:

```json
{
  "status": "success",
  "sessionId": "abc12345-1234-4567-89ab-cdef01234567",
  "previousStatus": "pending",
  "newStatus": "approved"
}
```

#### Apply Session (Pro Plan Required)

```bash
curl -X POST https://your-worker.workers.dev/review/{sessionId}/apply \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-GitHub-Token: $GITHUB_TOKEN"
```

Response:

```json
{
  "status": "success",
  "sessionId": "abc12345-1234-4567-89ab-cdef01234567",
  "applied": true,
  "commitShas": ["abc123", "def456"],
  "message": "Successfully applied 2 patches"
}
```

#### Review Session Error Codes

Additional error codes for review endpoints:

- `SESSION_NOT_FOUND` - Session ID not found (404)
- `SESSION_EXPIRED` - Session has expired (410)
- `SESSION_NOT_APPROVED` - Session must be approved before apply (400)
- `SESSION_ALREADY_APPLIED` - Session was already applied (409)

#### Session Lifecycle

1. **Create**: `POST /review/create` creates a pending session (24h TTL)
2. **Review**: `GET /review/{id}` to view diff previews and planned changes
3. **Approve**: `POST /review/{id}/approve` marks session as approved (pro plan)
4. **Apply**: `POST /review/{id}/apply` writes changes to GitHub (pro plan, requires GitHub token)

Sessions are immutable after creation. The apply endpoint is idempotent - if already applied, it returns existing commit SHAs.
