/**
 * Test Harness for Opportunity Scoring
 *
 * Loads mock ingestion and GSC snapshot data, runs the opportunity scorer,
 * and prints the top 10 action queue items.
 *
 * USAGE:
 *   npx ts-node scripts/testOpportunityScoring.ts
 *
 * NOTE: This harness uses local mock data only. No internet access required.
 */

import * as fs from 'fs';
import * as path from 'path';

import { validateGscSnapshot, type GscSnapshotRow } from '../core/intelligence/gscSnapshot.types';
import { matchGscToPages, normalizePath } from '../core/intelligence/gscSnapshot.normalise';
import { scorePages, type PageScoringInput } from '../core/intelligence/opportunityScorer';
import { generateActionQueue, selectTopTargets } from '../core/intelligence/actionQueue';

/**
 * Mock ingestion page structure.
 */
interface MockPage {
  url: string;
  path: string;
  geoScore: number;
  gaps: Array<{ flag: string; severity: string }>;
}

/**
 * Mock ingestion result structure.
 */
interface MockIngestionResult {
  siteUrl: string;
  totalPages: number;
  pagesAnalyzed: number;
  pages: MockPage[];
}

/**
 * Loads and parses the mock ingestion JSON file.
 */
function loadMockIngestion(): MockIngestionResult {
  const filePath = path.join(__dirname, 'mock.ingestion.json');
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as MockIngestionResult;
}

/**
 * Loads and parses the mock GSC snapshot JSON file.
 */
function loadMockGscSnapshot(): GscSnapshotRow[] {
  const filePath = path.join(__dirname, 'mock.gscSnapshot.json');
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as GscSnapshotRow[];
}

/**
 * Main test function.
 */
function main(): void {
  console.log('========================================');
  console.log('Opportunity Scoring Test Harness');
  console.log('========================================\n');

  // Load mock data
  console.log('Loading mock data...');
  const ingestionResult = loadMockIngestion();
  const gscRawData = loadMockGscSnapshot();

  console.log(`  Site: ${ingestionResult.siteUrl}`);
  console.log(`  Ingested pages: ${ingestionResult.pages.length}`);
  console.log(`  GSC rows: ${gscRawData.length}\n`);

  // Validate GSC snapshot
  console.log('Validating GSC snapshot...');
  const validation = validateGscSnapshot(gscRawData);
  if (!validation.valid) {
    console.log('  Validation errors:');
    for (const error of validation.errors) {
      console.log(`    Row ${error.rowIndex}: ${error.field} - ${error.message}`);
    }
  }
  console.log(`  Valid rows: ${validation.validRows.length}\n`);

  // Match GSC data to ingested pages
  console.log('Matching GSC data to pages...');
  const ingestedUrls = ingestionResult.pages.map(p => p.url);
  const matchResults = matchGscToPages(ingestedUrls, validation.validRows);

  const pagesWithGsc = matchResults.filter(m => m.hasGscData).length;
  console.log(`  Pages matched with GSC data: ${pagesWithGsc}/${matchResults.length}\n`);

  // Show aggregation example
  console.log('GSC Aggregation Examples:');
  for (const match of matchResults) {
    if (match.gscMetrics && match.gscMetrics.originalPages.length > 1) {
      console.log(`  ${match.path}:`);
      console.log(`    Aggregated from: ${match.gscMetrics.originalPages.join(', ')}`);
      console.log(`    Total impressions: ${match.gscMetrics.impressions}`);
      console.log(`    Weighted position: ${match.gscMetrics.position.toFixed(2)}`);
    }
  }
  console.log('');

  // Build scoring inputs
  console.log('Building scoring inputs...');
  const scoringInputs: PageScoringInput[] = [];

  for (const page of ingestionResult.pages) {
    const normalizedPath = normalizePath(page.url);
    const match = matchResults.find(m => m.path === normalizedPath);
    const gscMetrics = match?.gscMetrics || null;

    scoringInputs.push({
      url: page.url,
      path: normalizedPath,
      geoScore: page.geoScore,
      gapFlags: page.gaps.map(g => g.flag),
      gscMetrics,
    });
  }

  // Score pages
  console.log('Scoring pages...');
  const scoredPages = scorePages(scoringInputs);
  console.log(`  Scored ${scoredPages.length} pages\n`);

  // Generate action queue
  console.log('Generating action queue...');
  const actionQueue = generateActionQueue(scoredPages);
  console.log(`  Total pages: ${actionQueue.totalPagesAnalyzed}`);
  console.log(`  Pages with GSC data: ${actionQueue.pagesWithGscData}`);
  console.log(`  Average score: ${actionQueue.averageScore.toFixed(2)}\n`);

  // Print top 10 action queue items
  console.log('========================================');
  console.log('TOP 10 ACTION QUEUE ITEMS');
  console.log('========================================\n');

  const top10 = actionQueue.items.slice(0, 10);

  for (let i = 0; i < top10.length; i++) {
    const item = top10[i];
    console.log(`${i + 1}. ${item.path}`);
    console.log(`   URL: ${item.url}`);
    console.log(`   Total Score: ${item.totalScore.toFixed(2)}`);
    console.log(`   Score Breakdown:`);
    console.log(`     - GEO Gap Score: ${item.scoreBreakdown.geoGapScore.toFixed(2)}`);
    console.log(`     - Impression Score: ${item.scoreBreakdown.impressionScore}`);
    console.log(`     - CTR Opportunity: ${item.scoreBreakdown.ctrOpportunityScore}`);
    console.log(`     - Striking Distance: ${item.scoreBreakdown.strikingDistanceScore}`);
    console.log(`     - Depth Opportunity: ${item.scoreBreakdown.depthOpportunityScore}`);
    console.log(`   Has GSC Data: ${item.scoreBreakdown.hasGscData ? 'Yes' : 'No'}`);
    console.log(`   Recommended Action: ${item.recommendedNextAction}`);
    console.log(`   Evidence:`);
    for (const ev of item.evidence) {
      console.log(`     - ${ev}`);
    }
    console.log('');
  }

  // Select top targets for improve mode
  console.log('========================================');
  console.log('AUTO-SELECTED TARGETS FOR IMPROVE MODE');
  console.log('========================================\n');

  const topTargets = selectTopTargets(actionQueue, 5);
  console.log('Top 5 paths to target:');
  for (let i = 0; i < topTargets.length; i++) {
    console.log(`  ${i + 1}. ${topTargets[i]}`);
  }
  console.log('');

  // Summary
  console.log('========================================');
  console.log('TEST COMPLETE');
  console.log('========================================');
}

// Run the test
main();
