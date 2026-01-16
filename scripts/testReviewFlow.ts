/**
 * Test Harness for Review Flow
 *
 * Tests the review session model, serialization/deserialization, and TTL logic.
 * No real Worker calls - uses local mock data only.
 *
 * USAGE:
 *   npx ts-node scripts/testReviewFlow.ts
 *
 * NOTE: This harness uses local mock data only. No internet access required.
 */

import {
  generateSessionId,
  buildSessionKey,
  calculateExpiresAt,
  isSessionExpired,
  createReviewSession,
  serializeSession,
  deserializeSession,
  canApproveSession,
  canApplySession,
  isValidSessionId,
  DEFAULT_SESSION_TTL_MS,
} from '../worker/reviewSessions';
import type {
  ReviewSession,
  ReviewPlannedFile,
  ReviewDiffPreview,
  ReviewPatch,
  TargetRepoConfig,
} from '../worker/types';

/**
 * Creates a mock review session for testing.
 */
function createMockSession(): ReviewSession {
  const targetRepo: TargetRepoConfig = {
    owner: 'example-org',
    repo: 'example-site',
    branch: 'main',
    projectType: 'astro-pages',
    routeStrategy: 'path-index',
  };

  const plannedFiles: ReviewPlannedFile[] = [
    {
      url: 'https://example.com/',
      filePath: 'src/pages/index.astro',
      action: 'update',
      humanReviewRequired: true,
      reviewNotes: ['Contains placeholder values that require real data'],
    },
    {
      url: 'https://example.com/services',
      filePath: 'src/pages/services/index.astro',
      action: 'create',
      humanReviewRequired: false,
      reviewNotes: [],
    },
  ];

  const diffPreviews: ReviewDiffPreview[] = [
    {
      filePath: 'src/pages/index.astro',
      action: 'update',
      diff: `--- a/src/pages/index.astro
+++ b/src/pages/index.astro
@@ -10,6 +10,12 @@
 </head>
 <body>
   <main>
+
+<!-- nico-geo:block:answer-capsule:start -->
+<div class="geo-answer-capsule">
+  <p>Example business provides quality services...</p>
+</div>
+<!-- nico-geo:block:answer-capsule:end -->
+
   </main>
 </body>`,
      truncated: false,
    },
    {
      filePath: 'src/pages/services/index.astro',
      action: 'create',
      diff: `--- /dev/null
+++ b/src/pages/services/index.astro
@@ -0,0 +1,20 @@
+---
+// GEO-generated page
+---
+<!DOCTYPE html>
+<html lang="en">
+...`,
      truncated: true,
    },
  ];

  const patches: ReviewPatch[] = [
    {
      url: 'https://example.com/',
      filePath: 'src/pages/index.astro',
      newContent: '<!-- Updated content -->',
      originalContent: '<!-- Original content -->',
    },
    {
      url: 'https://example.com/services',
      filePath: 'src/pages/services/index.astro',
      newContent: '<!-- New service page content -->',
      originalContent: null,
    },
  ];

  return createReviewSession({
    siteUrl: 'https://example.com',
    selectedTargets: ['/', '/services'],
    plannedFiles,
    diffPreviews,
    patches,
    targetRepo,
  });
}

/**
 * Tests session ID generation.
 */
function testSessionIdGeneration(): void {
  console.log('Test: Session ID Generation');
  console.log('----------------------------');

  const id1 = generateSessionId();
  const id2 = generateSessionId();

  console.log(`  Generated ID 1: ${id1}`);
  console.log(`  Generated ID 2: ${id2}`);
  console.log(`  IDs are unique: ${id1 !== id2 ? 'PASS' : 'FAIL'}`);
  console.log(`  ID 1 is valid UUID: ${isValidSessionId(id1) ? 'PASS' : 'FAIL'}`);
  console.log(`  ID 2 is valid UUID: ${isValidSessionId(id2) ? 'PASS' : 'FAIL'}`);
  console.log('');
}

/**
 * Tests KV key building.
 */
function testKvKeyBuilding(): void {
  console.log('Test: KV Key Building');
  console.log('---------------------');

  const sessionId = 'abc12345-1234-4567-89ab-cdef01234567';
  const key = buildSessionKey(sessionId);

  console.log(`  Session ID: ${sessionId}`);
  console.log(`  KV Key: ${key}`);
  console.log(`  Key has correct prefix: ${key.startsWith('review_session_') ? 'PASS' : 'FAIL'}`);
  console.log('');
}

/**
 * Tests expiration calculation.
 */
function testExpirationCalculation(): void {
  console.log('Test: Expiration Calculation');
  console.log('----------------------------');

  const now = new Date('2024-01-15T12:00:00Z');

  // Test default TTL (24 hours)
  const defaultExpires = calculateExpiresAt(now);
  const expectedDefault = '2024-01-16T12:00:00.000Z';
  console.log(`  Created at: ${now.toISOString()}`);
  console.log(`  Default TTL: ${DEFAULT_SESSION_TTL_MS}ms (${DEFAULT_SESSION_TTL_MS / 1000 / 60 / 60} hours)`);
  console.log(`  Expires at: ${defaultExpires}`);
  console.log(`  Expected: ${expectedDefault}`);
  console.log(`  Default TTL correct: ${defaultExpires === expectedDefault ? 'PASS' : 'FAIL'}`);

  // Test custom TTL (1 hour)
  const customTTL = 60 * 60 * 1000; // 1 hour
  const customExpires = calculateExpiresAt(now, customTTL);
  const expectedCustom = '2024-01-15T13:00:00.000Z';
  console.log(`  Custom TTL: ${customTTL}ms (1 hour)`);
  console.log(`  Expires at: ${customExpires}`);
  console.log(`  Expected: ${expectedCustom}`);
  console.log(`  Custom TTL correct: ${customExpires === expectedCustom ? 'PASS' : 'FAIL'}`);
  console.log('');
}

/**
 * Tests session expiration detection.
 */
function testExpirationDetection(): void {
  console.log('Test: Expiration Detection');
  console.log('--------------------------');

  // Create a session that expires in 1 hour
  const session = createMockSession();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const oneHourFuture = new Date(Date.now() + 60 * 60 * 1000);
  const tomorrowPlus = new Date(Date.now() + 25 * 60 * 60 * 1000);

  console.log(`  Session expires at: ${session.expiresAt}`);
  console.log(`  Current time: ${new Date().toISOString()}`);

  // Should not be expired (current time is before expiration)
  console.log(`  Is expired now: ${isSessionExpired(session) ? 'YES' : 'NO'}`);

  // Test with future time (beyond expiration)
  const expiredCheck = isSessionExpired(session, tomorrowPlus);
  console.log(`  Is expired in 25 hours: ${expiredCheck ? 'PASS (expired)' : 'FAIL (not expired)'}`);

  // Test with time before expiration
  const notExpiredCheck = isSessionExpired(session, oneHourFuture);
  console.log(`  Is expired in 1 hour: ${notExpiredCheck ? 'FAIL (expired)' : 'PASS (not expired)'}`);
  console.log('');
}

/**
 * Tests session serialization and deserialization.
 */
function testSerialization(): void {
  console.log('Test: Serialization / Deserialization');
  console.log('-------------------------------------');

  const original = createMockSession();

  // Serialize
  const json = serializeSession(original);
  console.log(`  Original session ID: ${original.sessionId}`);
  console.log(`  Serialized length: ${json.length} characters`);

  // Deserialize
  const restored = deserializeSession(json);
  console.log(`  Deserialized: ${restored ? 'SUCCESS' : 'FAILED'}`);

  if (restored) {
    console.log(`  Restored session ID: ${restored.sessionId}`);
    console.log(`  IDs match: ${original.sessionId === restored.sessionId ? 'PASS' : 'FAIL'}`);
    console.log(`  Status preserved: ${original.status === restored.status ? 'PASS' : 'FAIL'}`);
    console.log(`  Site URL preserved: ${original.siteUrl === restored.siteUrl ? 'PASS' : 'FAIL'}`);
    console.log(`  Planned files count: ${restored.plannedFiles.length}`);
    console.log(`  Patches count: ${restored.patches.length}`);
  }

  // Test invalid JSON
  const invalidResult = deserializeSession('not valid json');
  console.log(`  Invalid JSON handled: ${invalidResult === null ? 'PASS' : 'FAIL'}`);

  // Test missing fields
  const incompleteResult = deserializeSession('{"sessionId": "test"}');
  console.log(`  Incomplete data handled: ${incompleteResult === null ? 'PASS' : 'FAIL'}`);
  console.log('');
}

/**
 * Tests approval validation.
 */
function testApprovalValidation(): void {
  console.log('Test: Approval Validation');
  console.log('-------------------------');

  // Fresh session - should be approvable
  const pendingSession = createMockSession();
  pendingSession.status = 'pending';
  const pendingResult = canApproveSession(pendingSession);
  console.log(`  Pending session can approve: ${pendingResult.canApprove ? 'PASS' : 'FAIL'}`);

  // Already approved - should still be approvable (idempotent)
  const approvedSession = createMockSession();
  approvedSession.status = 'approved';
  const approvedResult = canApproveSession(approvedSession);
  console.log(`  Approved session can approve (idempotent): ${approvedResult.canApprove ? 'PASS' : 'FAIL'}`);

  // Applied session - should not be approvable
  const appliedSession = createMockSession();
  appliedSession.status = 'applied';
  const appliedResult = canApproveSession(appliedSession);
  console.log(`  Applied session cannot approve: ${!appliedResult.canApprove ? 'PASS' : 'FAIL'}`);
  console.log(`    Reason: ${appliedResult.reason}`);

  // Expired session - should not be approvable
  const expiredSession = createMockSession();
  expiredSession.status = 'expired';
  const expiredResult = canApproveSession(expiredSession);
  console.log(`  Expired session cannot approve: ${!expiredResult.canApprove ? 'PASS' : 'FAIL'}`);
  console.log(`    Reason: ${expiredResult.reason}`);
  console.log('');
}

/**
 * Tests apply validation.
 */
function testApplyValidation(): void {
  console.log('Test: Apply Validation');
  console.log('----------------------');

  // Pending session - should not be applyable
  const pendingSession = createMockSession();
  pendingSession.status = 'pending';
  const pendingResult = canApplySession(pendingSession);
  console.log(`  Pending session cannot apply: ${!pendingResult.canApply ? 'PASS' : 'FAIL'}`);
  console.log(`    Reason: ${pendingResult.reason}`);

  // Approved session - should be applyable
  const approvedSession = createMockSession();
  approvedSession.status = 'approved';
  const approvedResult = canApplySession(approvedSession);
  console.log(`  Approved session can apply: ${approvedResult.canApply ? 'PASS' : 'FAIL'}`);

  // Already applied - should not be applyable but is idempotent
  const appliedSession = createMockSession();
  appliedSession.status = 'applied';
  appliedSession.commitShas = ['abc123', 'def456'];
  const appliedResult = canApplySession(appliedSession);
  console.log(`  Applied session idempotent: ${appliedResult.isIdempotent ? 'PASS' : 'FAIL'}`);
  console.log(`    Reason: ${appliedResult.reason}`);

  // Expired session - should not be applyable
  const expiredSession = createMockSession();
  expiredSession.status = 'expired';
  const expiredResult = canApplySession(expiredSession);
  console.log(`  Expired session cannot apply: ${!expiredResult.canApply ? 'PASS' : 'FAIL'}`);
  console.log(`    Reason: ${expiredResult.reason}`);
  console.log('');
}

/**
 * Tests session ID validation.
 */
function testSessionIdValidation(): void {
  console.log('Test: Session ID Validation');
  console.log('---------------------------');

  // Valid UUID v4
  const validId = 'abc12345-1234-4567-89ab-cdef01234567';
  console.log(`  Valid UUID '${validId}': ${isValidSessionId(validId) ? 'PASS' : 'FAIL'}`);

  // Generated ID
  const generatedId = generateSessionId();
  console.log(`  Generated UUID: ${isValidSessionId(generatedId) ? 'PASS' : 'FAIL'}`);

  // Invalid formats
  const invalidIds = [
    'not-a-uuid',
    '12345',
    'abc12345-1234-3567-89ab-cdef01234567', // v3 not v4
    'abc12345-1234-4567-29ab-cdef01234567', // invalid variant
    '',
  ];

  for (const id of invalidIds) {
    console.log(`  Invalid '${id || '(empty)'}': ${!isValidSessionId(id) ? 'PASS' : 'FAIL'}`);
  }
  console.log('');
}

/**
 * Main test function.
 */
function main(): void {
  console.log('========================================');
  console.log('Review Flow Test Harness');
  console.log('========================================\n');

  testSessionIdGeneration();
  testKvKeyBuilding();
  testExpirationCalculation();
  testExpirationDetection();
  testSerialization();
  testApprovalValidation();
  testApplyValidation();
  testSessionIdValidation();

  // Show example session
  console.log('========================================');
  console.log('Example Review Session');
  console.log('========================================\n');

  const exampleSession = createMockSession();
  console.log('Session Details:');
  console.log(`  Session ID: ${exampleSession.sessionId}`);
  console.log(`  Status: ${exampleSession.status}`);
  console.log(`  Site URL: ${exampleSession.siteUrl}`);
  console.log(`  Created: ${exampleSession.createdAt}`);
  console.log(`  Expires: ${exampleSession.expiresAt}`);
  console.log(`  Target Repo: ${exampleSession.targetRepo.owner}/${exampleSession.targetRepo.repo}`);
  console.log(`  Selected Targets: ${exampleSession.selectedTargets.join(', ')}`);
  console.log(`  Planned Files: ${exampleSession.plannedFiles.length}`);
  console.log(`  Diff Previews: ${exampleSession.diffPreviews.length}`);
  console.log(`  Patches: ${exampleSession.patches.length}`);
  console.log('');

  console.log('Planned Files:');
  for (const file of exampleSession.plannedFiles) {
    console.log(`  - ${file.filePath}`);
    console.log(`    URL: ${file.url}`);
    console.log(`    Action: ${file.action}`);
    console.log(`    Review Required: ${file.humanReviewRequired}`);
    if (file.reviewNotes.length > 0) {
      console.log(`    Notes: ${file.reviewNotes.join(', ')}`);
    }
  }
  console.log('');

  console.log('========================================');
  console.log('TEST COMPLETE');
  console.log('========================================');
}

// Run the test
main();
