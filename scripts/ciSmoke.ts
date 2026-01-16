/**
 * CI Smoke Tests
 *
 * Minimal offline tests that verify core modules can be imported and
 * basic functionality works with mock data. No internet required.
 *
 * USAGE:
 *   npx ts-node scripts/ciSmoke.ts
 *
 * EXIT CODES:
 *   0 - All tests passed
 *   1 - One or more tests failed
 *
 * These tests run as part of CI to catch obvious regressions before deployment.
 */

// Track test results
let passed = 0;
let failed = 0;

/**
 * Runs a test and tracks the result.
 */
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

/**
 * Asserts a condition is true.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Asserts two values are equal.
 */
function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function main() {
  console.log('========================================');
  console.log('CI Smoke Tests');
  console.log('========================================\n');

  // ========================================
  // Test 1: BusinessInput Validator Import
  // ========================================
  console.log('1. BusinessInput Validator');

  await test('can import validator module', () => {
    const { validateBusinessInput } = require('../core/rules/businessInput.validator');
    assert(typeof validateBusinessInput === 'function', 'validateBusinessInput should be a function');
  });

  await test('validates valid business input', () => {
    const { validateBusinessInput } = require('../core/rules/businessInput.validator');
    const validInput = {
      business: { name: 'Test Business' },
      location: {
        primaryCity: 'Austin',
        country: 'USA',
        serviceAreas: ['Austin', 'Round Rock'],
      },
      services: { primary: ['Consulting'] },
      constraints: { noHallucinations: true },
    };
    const result = validateBusinessInput(validInput);
    assert(result.valid, 'Should validate correct input');
  });

  await test('rejects invalid business input', () => {
    const { validateBusinessInput } = require('../core/rules/businessInput.validator');
    const invalidInput = {
      business: {}, // missing name
      location: {},
      services: {},
      constraints: {},
    };
    const result = validateBusinessInput(invalidInput);
    assert(!result.valid, 'Should reject invalid input');
    assert(result.errors.length > 0, 'Should have validation errors');
  });

  // ========================================
  // Test 2: Opportunity Scoring
  // ========================================
  console.log('\n2. Opportunity Scoring');

  await test('can import opportunity scorer module', () => {
    const { scorePage, scorePages } = require('../core/intelligence/opportunityScorer');
    assert(typeof scorePage === 'function', 'scorePage should be a function');
    assert(typeof scorePages === 'function', 'scorePages should be a function');
  });

  await test('scores pages deterministically', () => {
    const { scorePages } = require('../core/intelligence/opportunityScorer');
    const input = [{
      url: 'https://example.com/',
      path: '/',
      geoScore: 40, // Low GEO score = higher opportunity
      gapFlags: ['missingTitle', 'missingSchema', 'missingFaq', 'missingAnswerCapsule'],
      gscMetrics: {
        clicks: 100,
        impressions: 5000,
        ctr: 0.02,
        position: 8.5,
      },
    }];
    const result = scorePages(input);
    assert(result.length === 1, 'Should return one scored page');
    assert(typeof result[0].totalScore === 'number', 'Should have totalScore');
    assert(result[0].totalScore > 0, 'Should have positive score');
  });

  // ========================================
  // Test 3: Path Contract
  // ========================================
  console.log('\n3. Path Contract');

  await test('can import path contract module', () => {
    const { mapUrlToFilePath } = require('../core/writeback/pathContract');
    assert(typeof mapUrlToFilePath === 'function', 'mapUrlToFilePath should be a function');
  });

  await test('maps URLs to file paths (astro-pages)', () => {
    const { mapUrlToFilePath } = require('../core/writeback/pathContract');
    const config = {
      projectType: 'astro-pages' as const,
      routeStrategy: 'path-index' as const,
    };
    const result = mapUrlToFilePath('https://example.com/services', config);
    assert(result.filePath === 'src/pages/services/index.astro', `Unexpected path: ${result.filePath}`);
  });

  await test('maps root URL correctly', () => {
    const { mapUrlToFilePath } = require('../core/writeback/pathContract');
    const config = {
      projectType: 'astro-pages' as const,
      routeStrategy: 'path-index' as const,
    };
    const result = mapUrlToFilePath('https://example.com/', config);
    assert(result.filePath === 'src/pages/index.astro', `Unexpected path: ${result.filePath}`);
  });

  // ========================================
  // Test 4: Patch Applier
  // ========================================
  console.log('\n4. Patch Applier');

  await test('can import patch applier module', () => {
    const { planPatches, generatePatches } = require('../core/writeback/patchApplier');
    assert(typeof planPatches === 'function', 'planPatches should be a function');
    assert(typeof generatePatches === 'function', 'generatePatches should be a function');
  });

  // ========================================
  // Test 5: GSC Snapshot Validation
  // ========================================
  console.log('\n5. GSC Snapshot Validation');

  await test('can import gsc snapshot types', () => {
    const { validateGscSnapshot } = require('../core/intelligence/gscSnapshot.types');
    assert(typeof validateGscSnapshot === 'function', 'validateGscSnapshot should be a function');
  });

  await test('validates valid GSC snapshot', () => {
    const { validateGscSnapshot } = require('../core/intelligence/gscSnapshot.types');
    const validSnapshot = [
      {
        page: 'https://example.com/',
        clicks: 100,
        impressions: 5000,
        ctr: 0.02,
        position: 8.5,
        dateRange: '2024-01-01 to 2024-01-31',
      },
    ];
    const result = validateGscSnapshot(validSnapshot);
    assert(result.valid || result.validRows.length > 0, 'Should have valid rows');
  });

  await test('rejects invalid GSC snapshot', () => {
    const { validateGscSnapshot } = require('../core/intelligence/gscSnapshot.types');
    const invalidSnapshot = [
      {
        page: 'not-a-url',
        clicks: -1,
        impressions: 'invalid',
      },
    ];
    const result = validateGscSnapshot(invalidSnapshot);
    assert(!result.valid || result.errors.length > 0, 'Should have validation errors');
  });

  // ========================================
  // Test 6: Action Queue
  // ========================================
  console.log('\n6. Action Queue');

  await test('can import action queue module', () => {
    const { generateActionQueue, selectTopTargets } = require('../core/intelligence/actionQueue');
    assert(typeof generateActionQueue === 'function', 'generateActionQueue should be a function');
    assert(typeof selectTopTargets === 'function', 'selectTopTargets should be a function');
  });

  // ========================================
  // Test 7: Review Sessions
  // ========================================
  console.log('\n7. Review Sessions');

  await test('can import review sessions module', () => {
    const {
      generateSessionId,
      createReviewSession,
      isSessionExpired,
      canApproveSession,
      canApplySession,
    } = require('../worker/reviewSessions');
    assert(typeof generateSessionId === 'function', 'generateSessionId should be a function');
    assert(typeof createReviewSession === 'function', 'createReviewSession should be a function');
    assert(typeof isSessionExpired === 'function', 'isSessionExpired should be a function');
    assert(typeof canApproveSession === 'function', 'canApproveSession should be a function');
    assert(typeof canApplySession === 'function', 'canApplySession should be a function');
  });

  await test('generates valid session IDs', () => {
    const { generateSessionId, isValidSessionId } = require('../worker/reviewSessions');
    const id = generateSessionId();
    assert(typeof id === 'string', 'Should generate string ID');
    assert(isValidSessionId(id), 'Generated ID should be valid');
  });

  await test('validates session approval rules', () => {
    const { canApproveSession, createReviewSession } = require('../worker/reviewSessions');
    const session = createReviewSession({
      siteUrl: 'https://example.com',
      selectedTargets: ['/'],
      plannedFiles: [],
      diffPreviews: [],
      patches: [],
      targetRepo: {
        owner: 'test',
        repo: 'test',
        branch: 'main',
        projectType: 'astro-pages',
        routeStrategy: 'path-index',
      },
    });
    const result = canApproveSession(session);
    assert(result.canApprove, 'Pending session should be approvable');
  });

  // ========================================
  // Test 8: Observability
  // ========================================
  console.log('\n8. Observability');

  await test('can import observability module', () => {
    const { generateRequestId, Logger, nowIso } = require('../worker/observability');
    assert(typeof generateRequestId === 'function', 'generateRequestId should be a function');
    assert(typeof Logger === 'function', 'Logger should be a constructor');
    assert(typeof nowIso === 'function', 'nowIso should be a function');
  });

  await test('generates valid request IDs', () => {
    const { generateRequestId } = require('../worker/observability');
    const id = generateRequestId();
    assert(typeof id === 'string', 'Should generate string ID');
    assert(id.length > 0, 'ID should not be empty');
  });

  // ========================================
  // Test 9: Error Module
  // ========================================
  console.log('\n9. Error Module');

  await test('can import error module', () => {
    const { buildErrorBody, ERROR_STATUS_CODES, VERSION_INFO } = require('../worker/errors');
    assert(typeof buildErrorBody === 'function', 'buildErrorBody should be a function');
    assert(typeof ERROR_STATUS_CODES === 'object', 'ERROR_STATUS_CODES should be an object');
    assert(typeof VERSION_INFO === 'object', 'VERSION_INFO should be an object');
  });

  await test('builds error body correctly', () => {
    const { buildErrorBody } = require('../worker/errors');
    const body = buildErrorBody('req-123', 'VALIDATION_ERROR', 'Test error');
    assert(body.status === 'error', 'Status should be error');
    assert(body.requestId === 'req-123', 'Should have requestId');
    assert(body.errorCode === 'VALIDATION_ERROR', 'Should have errorCode');
    assert(body.message === 'Test error', 'Should have message');
  });

  // ========================================
  // Summary
  // ========================================
  console.log('\n========================================');
  console.log('Summary');
  console.log('========================================');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log('========================================\n');

  if (failed > 0) {
    console.log('CI SMOKE TESTS FAILED');
    process.exit(1);
  } else {
    console.log('CI SMOKE TESTS PASSED');
    process.exit(0);
  }
}

// Run tests
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
