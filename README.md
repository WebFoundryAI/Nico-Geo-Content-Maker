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
