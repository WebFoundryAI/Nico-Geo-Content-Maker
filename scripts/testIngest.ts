/**
 * Test Harness for Site Ingestion and GEO Analysis
 *
 * This script provides a local testing harness for the ingestion pipeline.
 * It can crawl a site, analyze GEO gaps, and generate improvement plans.
 *
 * USAGE:
 *   npx ts-node scripts/testIngest.ts
 *
 * CONFIGURATION:
 *   Replace TEST_URL with the site you want to analyze.
 *   The default is a placeholder - DO NOT call external URLs during automated tests.
 *
 * NOTE: This harness is for manual local testing only.
 *       Do not use in CI/CD without explicit URL configuration.
 */

import { crawlSite } from '../core/ingest/siteCrawler';
import { analyzeGeoGaps } from '../core/analyze/geoGapAnalyzer';
import { planSiteImprovements } from '../core/analyze/improvementPlanner';

/**
 * TEST CONFIGURATION
 *
 * Replace this URL with a real site URL for testing.
 * IMPORTANT: Keep this as a placeholder for committed code.
 * Only modify locally for manual testing.
 */
const TEST_URL = 'https://example.com'; // Replace with actual URL for testing

/**
 * Maximum pages to crawl during test.
 */
const MAX_PAGES = 5;

/**
 * Main test function.
 */
async function main(): Promise<void> {
  console.log('========================================');
  console.log('GEO Ingestion & Analysis Test Harness');
  console.log('========================================\n');

  console.log(`Target URL: ${TEST_URL}`);
  console.log(`Max Pages: ${MAX_PAGES}`);
  console.log('');

  // Check if using placeholder URL
  if (TEST_URL === 'https://example.com') {
    console.log('⚠️  WARNING: Using placeholder URL (example.com)');
    console.log('   This is intentional for safe testing.');
    console.log('   For real analysis, replace TEST_URL with target site.\n');
  }

  try {
    // Step 1: Crawl the site
    console.log('Step 1: Crawling site...');
    console.log('-'.repeat(40));

    const crawlResult = await crawlSite(TEST_URL, { maxPages: MAX_PAGES });

    console.log(`✓ Crawl complete`);
    console.log(`  - Pages analyzed: ${crawlResult.pagesAnalyzed}`);
    console.log(`  - Sitemap found: ${crawlResult.sitemapFound}`);
    console.log(`  - Errors: ${crawlResult.errors.length}`);

    if (crawlResult.errors.length > 0) {
      console.log(`  - Error details:`);
      for (const error of crawlResult.errors.slice(0, 5)) {
        console.log(`    • ${error}`);
      }
    }
    console.log('');

    // Step 2: Run gap analysis
    console.log('Step 2: Analyzing GEO gaps...');
    console.log('-'.repeat(40));

    const gapAnalysis = analyzeGeoGaps(crawlResult);

    console.log(`✓ Analysis complete`);
    console.log(`  - Average GEO Score: ${gapAnalysis.averageGeoScore}%`);
    console.log(`  - Pages with gaps: ${gapAnalysis.pagesWithGaps}`);
    console.log(`  - Critical issues: ${gapAnalysis.criticalIssues}`);
    console.log(`  - Warnings: ${gapAnalysis.warnings}`);
    console.log(`  - Suggestions: ${gapAnalysis.suggestions}`);
    console.log('');

    // Show per-page summary
    console.log('  Per-page breakdown:');
    for (const page of gapAnalysis.pages) {
      const icon = page.geoScore >= 70 ? '✓' : page.geoScore >= 40 ? '⚠' : '✗';
      console.log(`    ${icon} [${page.geoScore}%] ${page.url}`);
      console.log(`       Gaps: ${page.gaps.length}, Service: ${page.isServicePage}, Location: ${page.isLocationPage}`);
    }
    console.log('');

    // Step 3: Generate improvement plan
    console.log('Step 3: Generating improvement plan...');
    console.log('-'.repeat(40));

    const improvementPlan = planSiteImprovements(crawlResult);

    console.log(`✓ Improvement plan generated`);
    console.log(`  - Pages with improvements: ${improvementPlan.pagesWithImprovements}`);
    console.log(`  - Site-wide suggestions: ${improvementPlan.siteWideSuggestions.length}`);
    console.log('');

    // Show improvement details for first few pages
    console.log('  Sample improvements (first 3 pages):');
    for (const page of improvementPlan.pages.slice(0, 3)) {
      console.log(`\n  📄 ${page.url}`);
      console.log(`     Impact: ${page.estimatedImpact}`);

      if (page.recommendedTitle) {
        console.log(`     → Recommended title: ${page.recommendedTitle.substring(0, 60)}...`);
      }
      if (page.recommendedMetaDescription) {
        console.log(`     → Recommended meta: ${page.recommendedMetaDescription.substring(0, 60)}...`);
      }
      if (page.suggestedAdditions.answerCapsule) {
        console.log(`     → Answer capsule suggested`);
      }
      if (page.suggestedAdditions.faq) {
        console.log(`     → FAQ suggestions: ${page.suggestedAdditions.faq.length} items`);
      }
      if (page.suggestedAdditions.schemaJsonLd) {
        console.log(`     → Schema.org markup suggested`);
      }
      if (page.priorityActions.length > 0) {
        console.log(`     → Priority actions:`);
        for (const action of page.priorityActions.slice(0, 2)) {
          console.log(`       • ${action.substring(0, 70)}${action.length > 70 ? '...' : ''}`);
        }
      }
    }

    console.log('\n');
    console.log('========================================');
    console.log('Test Complete');
    console.log('========================================');

    // Output full JSON results for debugging
    console.log('\n📋 Full results available in memory.');
    console.log('   Uncomment the lines below to dump full JSON:\n');
    // console.log('\n--- FULL CRAWL RESULT ---');
    // console.log(JSON.stringify(crawlResult, null, 2));
    // console.log('\n--- FULL GAP ANALYSIS ---');
    // console.log(JSON.stringify(gapAnalysis, null, 2));
    // console.log('\n--- FULL IMPROVEMENT PLAN ---');
    // console.log(JSON.stringify(improvementPlan, null, 2));

  } catch (error) {
    console.error('❌ Test failed with error:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);
