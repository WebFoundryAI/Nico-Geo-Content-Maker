/**
 * Test Harness for Write-Back Planning with Path Contract
 *
 * This script tests the path contract, diff preview, and idempotency features
 * of the write-back system without requiring GitHub access.
 *
 * USAGE:
 *   npx ts-node scripts/testWriteBackPlan.ts
 *
 * NOTE: This harness is for local testing only. It does not make any GitHub API calls.
 */

import {
  mapUrlToFilePath,
  mapUrlsToFilePaths,
  PathContractConfig,
  PathMappingError,
} from '../core/writeback/pathContract';
import {
  planPatches,
  PatchPlanConfig,
} from '../core/writeback/patchApplier';
import type { PageImprovementPlan } from '../core/analyze/improvementPlanner';

/**
 * Test configurations for path contract.
 */
const PATH_CONTRACT_TESTS: Array<{
  name: string;
  config: PathContractConfig;
  urls: string[];
  expectedMappings: Array<{ url: string; filePath: string }>;
}> = [
  {
    name: 'Astro Pages with Path-Index Strategy',
    config: { projectType: 'astro-pages', routeStrategy: 'path-index' },
    urls: [
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/services/plumbing',
      'https://example.com/contact/',
    ],
    expectedMappings: [
      { url: 'https://example.com/', filePath: 'src/pages/index.astro' },
      { url: 'https://example.com/about', filePath: 'src/pages/about/index.astro' },
      { url: 'https://example.com/services/plumbing', filePath: 'src/pages/services/plumbing/index.astro' },
      { url: 'https://example.com/contact/', filePath: 'src/pages/contact/index.astro' },
    ],
  },
  {
    name: 'Astro Pages with Flat-HTML Strategy',
    config: { projectType: 'astro-pages', routeStrategy: 'flat-html' },
    urls: [
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/services/plumbing',
    ],
    expectedMappings: [
      { url: 'https://example.com/', filePath: 'src/pages/index.astro' },
      { url: 'https://example.com/about', filePath: 'src/pages/about.astro' },
      { url: 'https://example.com/services/plumbing', filePath: 'src/pages/services-plumbing.astro' },
    ],
  },
  {
    name: 'Static HTML with Path-Index Strategy',
    config: { projectType: 'static-html', routeStrategy: 'path-index' },
    urls: [
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/services/plumbing',
    ],
    expectedMappings: [
      { url: 'https://example.com/', filePath: 'index.html' },
      { url: 'https://example.com/about', filePath: 'about/index.html' },
      { url: 'https://example.com/services/plumbing', filePath: 'services/plumbing/index.html' },
    ],
  },
  {
    name: 'Static HTML with Flat-HTML Strategy',
    config: { projectType: 'static-html', routeStrategy: 'flat-html' },
    urls: [
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/services/plumbing',
    ],
    expectedMappings: [
      { url: 'https://example.com/', filePath: 'index.html' },
      { url: 'https://example.com/about', filePath: 'about.html' },
      { url: 'https://example.com/services/plumbing', filePath: 'services-plumbing.html' },
    ],
  },
];

/**
 * Sample improvement plans for testing patch planning.
 */
const SAMPLE_IMPROVEMENTS: PageImprovementPlan[] = [
  {
    url: 'https://example.com/',
    recommendedTitle: 'Example Business | Professional Services in City',
    recommendedMetaDescription: 'Example Business provides professional services in City. Contact us for quality work.',
    suggestedAdditions: {
      answerCapsule: 'Example Business is a trusted provider of professional services in the City area.',
      faq: [
        {
          question: 'What services do you offer?',
          answer: 'We offer a wide range of professional services.',
          isPlaceholder: false,
        },
        {
          question: 'What are your hours?',
          answer: '[ADD ACTUAL BUSINESS HOURS]',
          isPlaceholder: true,
        },
      ],
      schemaJsonLd: {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: 'Example Business',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '[ADD STREET ADDRESS]',
          addressLocality: 'City',
          addressRegion: '[ADD STATE]',
          postalCode: '[ADD ZIP]',
        },
      },
    },
    priorityActions: [
      'Add geo-targeted title and meta description',
      'Add FAQ section',
      'Add LocalBusiness schema markup',
    ],
    estimatedImpact: 'high',
    currentGeoScore: 25,
    targetGeoScore: 85,
  },
  {
    url: 'https://example.com/services/plumbing',
    recommendedTitle: 'Plumbing Services | Example Business in City',
    recommendedMetaDescription: 'Professional plumbing services in City from Example Business. Licensed plumbers available.',
    suggestedAdditions: {
      answerCapsule: 'Example Business provides expert plumbing services throughout City and surrounding areas.',
      faq: [
        {
          question: 'Do you offer emergency plumbing services?',
          answer: 'Yes, we offer 24/7 emergency plumbing services.',
          isPlaceholder: false,
        },
      ],
    },
    priorityActions: [
      'Add service-specific title and meta',
      'Add answer capsule for featured snippet',
    ],
    estimatedImpact: 'medium',
    currentGeoScore: 40,
    targetGeoScore: 75,
  },
];

/**
 * Simulated existing file content (for idempotency testing).
 */
const EXISTING_FILE_CONTENT = `---
// Existing Astro page
---

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Old Title</title>
</head>
<body>
  <main>
    <h1>Welcome</h1>
    <p>Existing content here.</p>

<!-- nico-geo:block:meta:start -->
<!-- TODO: Review and customize these recommendations -->
<!-- Recommended Title: OLD TITLE HERE -->
<!-- nico-geo:block:meta:end -->

  </main>
</body>
</html>
`;

/**
 * Runs path contract tests.
 */
function runPathContractTests(): { passed: number; failed: number } {
  console.log('========================================');
  console.log('Path Contract Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  for (const test of PATH_CONTRACT_TESTS) {
    console.log(`Test: ${test.name}`);
    console.log(`  Config: projectType=${test.config.projectType}, routeStrategy=${test.config.routeStrategy}`);
    console.log('  Results:');

    for (const expected of test.expectedMappings) {
      try {
        const result = mapUrlToFilePath(expected.url, test.config);
        const success = result.filePath === expected.filePath;

        if (success) {
          console.log(`    ✓ ${expected.url} → ${result.filePath}`);
          passed++;
        } else {
          console.log(`    ✗ ${expected.url}`);
          console.log(`      Expected: ${expected.filePath}`);
          console.log(`      Got:      ${result.filePath}`);
          failed++;
        }
      } catch (err) {
        console.log(`    ✗ ${expected.url}`);
        console.log(`      Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        failed++;
      }
    }
    console.log('');
  }

  return { passed, failed };
}

/**
 * Runs path safety tests.
 */
function runPathSafetyTests(): { passed: number; failed: number } {
  console.log('========================================');
  console.log('Path Safety Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  const config: PathContractConfig = { projectType: 'astro-pages', routeStrategy: 'path-index' };

  const dangerousUrls = [
    'https://example.com/../../../etc/passwd',
    'https://example.com/path<script>alert(1)</script>',
    'https://example.com/path|command',
    'https://example.com/' + 'a'.repeat(250), // Too long
  ];

  for (const url of dangerousUrls) {
    try {
      mapUrlToFilePath(url, config);
      console.log(`  ✗ Should have rejected: ${url.substring(0, 50)}...`);
      failed++;
    } catch (err) {
      if (err instanceof PathMappingError) {
        console.log(`  ✓ Correctly rejected: ${url.substring(0, 50)}...`);
        console.log(`    Reason: ${err.reason}`);
        passed++;
      } else {
        console.log(`  ✗ Wrong error type for: ${url.substring(0, 50)}...`);
        failed++;
      }
    }
  }
  console.log('');

  return { passed, failed };
}

/**
 * Runs patch planning tests.
 */
function runPatchPlanningTests(): { passed: number; failed: number } {
  console.log('========================================');
  console.log('Patch Planning Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  const config: PatchPlanConfig = {
    pathContract: { projectType: 'astro-pages', routeStrategy: 'path-index' },
  };

  // Test 1: Planning with no existing content
  console.log('Test 1: Planning patches for new files');
  const emptyContents = new Map<string, string | null>();
  const planResult1 = planPatches(SAMPLE_IMPROVEMENTS, emptyContents, config);

  if (planResult1.plannedChanges.length === 2) {
    console.log(`  ✓ Generated ${planResult1.plannedChanges.length} planned changes`);
    passed++;
  } else {
    console.log(`  ✗ Expected 2 planned changes, got ${planResult1.plannedChanges.length}`);
    failed++;
  }

  if (planResult1.plannedChanges.every(c => c.action === 'create')) {
    console.log('  ✓ All actions are "create" for new files');
    passed++;
  } else {
    console.log('  ✗ Expected all actions to be "create"');
    failed++;
  }

  if (planResult1.diffPreviews.length === 2) {
    console.log(`  ✓ Generated ${planResult1.diffPreviews.length} diff previews`);
    passed++;
  } else {
    console.log(`  ✗ Expected 2 diff previews, got ${planResult1.diffPreviews.length}`);
    failed++;
  }

  console.log('');

  // Test 2: Planning with existing content (idempotency)
  console.log('Test 2: Planning patches for existing files (idempotency)');
  const existingContents = new Map<string, string | null>();
  existingContents.set('src/pages/index.astro', EXISTING_FILE_CONTENT);

  const planResult2 = planPatches(SAMPLE_IMPROVEMENTS, existingContents, config);

  const homePageChange = planResult2.plannedChanges.find(c => c.url === 'https://example.com/');
  if (homePageChange && homePageChange.action === 'update') {
    console.log('  ✓ Detected existing file, action is "update"');
    passed++;
  } else {
    console.log('  ✗ Expected action "update" for existing file');
    failed++;
  }

  // Check that markers are present in the new content
  if (homePageChange && homePageChange.newContent.includes('<!-- nico-geo:block:meta:start -->')) {
    console.log('  ✓ Idempotency markers present in output');
    passed++;
  } else {
    console.log('  ✗ Expected idempotency markers in output');
    failed++;
  }

  // Check that marker content is replaced, not duplicated
  const metaBlockCount = (homePageChange?.newContent.match(/<!-- nico-geo:block:meta:start -->/g) || []).length;
  if (metaBlockCount === 1) {
    console.log('  ✓ Marker block appears exactly once (idempotent replacement)');
    passed++;
  } else {
    console.log(`  ✗ Marker block appears ${metaBlockCount} times (expected 1)`);
    failed++;
  }

  console.log('');

  // Test 3: Check placeholder detection
  console.log('Test 3: Placeholder detection for human review');
  if (homePageChange && homePageChange.humanReviewRequired) {
    console.log('  ✓ Correctly flagged for human review (has placeholders)');
    passed++;
  } else {
    console.log('  ✗ Expected humanReviewRequired to be true');
    failed++;
  }

  console.log('');

  return { passed, failed };
}

/**
 * Runs diff preview tests.
 */
function runDiffPreviewTests(): { passed: number; failed: number } {
  console.log('========================================');
  console.log('Diff Preview Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  const config: PatchPlanConfig = {
    pathContract: { projectType: 'astro-pages', routeStrategy: 'path-index' },
  };

  // Plan with existing content
  const existingContents = new Map<string, string | null>();
  existingContents.set('src/pages/index.astro', EXISTING_FILE_CONTENT);

  const planResult = planPatches(SAMPLE_IMPROVEMENTS, existingContents, config);

  // Check diff format
  const homeDiff = planResult.diffPreviews.find(d => d.filePath === 'src/pages/index.astro');
  if (homeDiff) {
    if (homeDiff.diff.includes('--- a/')) {
      console.log('  ✓ Diff has unified format header (--- a/)');
      passed++;
    } else {
      console.log('  ✗ Expected unified diff format');
      failed++;
    }

    if (homeDiff.diff.includes('+++ b/')) {
      console.log('  ✓ Diff has unified format header (+++ b/)');
      passed++;
    } else {
      console.log('  ✗ Expected unified diff format');
      failed++;
    }

    if (homeDiff.diff.includes('@@')) {
      console.log('  ✓ Diff has hunk headers (@@)');
      passed++;
    } else {
      console.log('  ✗ Expected hunk headers');
      failed++;
    }

    // Show sample diff output
    console.log('\n  Sample diff preview:');
    const diffLines = homeDiff.diff.split('\n').slice(0, 15);
    for (const line of diffLines) {
      console.log(`    ${line}`);
    }
    if (homeDiff.diff.split('\n').length > 15) {
      console.log('    ... (truncated)');
    }
  } else {
    console.log('  ✗ No diff found for home page');
    failed++;
  }

  console.log('');

  return { passed, failed };
}

/**
 * Main test function.
 */
async function main(): Promise<void> {
  console.log('========================================');
  console.log('Write-Back Planning Test Harness');
  console.log('========================================\n');

  let totalPassed = 0;
  let totalFailed = 0;

  // Run all test suites
  const pathContractResults = runPathContractTests();
  totalPassed += pathContractResults.passed;
  totalFailed += pathContractResults.failed;

  const safetyResults = runPathSafetyTests();
  totalPassed += safetyResults.passed;
  totalFailed += safetyResults.failed;

  const planningResults = runPatchPlanningTests();
  totalPassed += planningResults.passed;
  totalFailed += planningResults.failed;

  const diffResults = runDiffPreviewTests();
  totalPassed += diffResults.passed;
  totalFailed += diffResults.failed;

  // Summary
  console.log('========================================');
  console.log('Test Summary');
  console.log('========================================');
  console.log(`  Total Passed: ${totalPassed}`);
  console.log(`  Total Failed: ${totalFailed}`);
  console.log(`  Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`);
  console.log('========================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

// Run the tests
main().catch(console.error);
