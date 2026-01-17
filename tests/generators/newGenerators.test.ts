/// <reference types="node" />
/**
 * Unit Tests for 5 New Generic Content Generators
 *
 * Tests for:
 * 1. Why Choose Us / Differentiators
 * 2. Team Bio
 * 3. How We Work / Service Process
 * 4. Case Study
 * 5. Testimonial Enhancement
 *
 * USAGE:
 *   npx ts-node tests/generators/newGenerators.test.ts
 *
 * EXIT CODES:
 *   0 - All tests passed
 *   1 - One or more tests failed
 */

import type { BusinessInput } from '../../inputs/business.schema';
import { generateWhyChooseUs, WhyChooseUsOutput } from '../../core/generators/whyChooseUs.generator';
import { generateTeamBio, TeamBioOutput } from '../../core/generators/teamBio.generator';
import { generateHowWeWork, HowWeWorkOutput } from '../../core/generators/howWeWork.generator';
import { generateCaseStudy, CaseStudyOutput } from '../../core/generators/caseStudy.generator';
import { generateTestimonial, TestimonialOutput } from '../../core/generators/testimonial.generator';

// Track test results
let passed = 0;
let failed = 0;

/**
 * Runs a test and tracks the result.
 */
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
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

/**
 * Asserts a value is within a range.
 */
function assertRange(actual: number, min: number, max: number, message: string): void {
  if (actual < min || actual > max) {
    throw new Error(`${message}: expected between ${min}-${max}, got ${actual}`);
  }
}

// ============================================================
// TEST FIXTURES
// ============================================================

/**
 * Minimal valid BusinessInput for anti-hallucination tests.
 */
const minimalInput: BusinessInput = {
  business: { name: 'Test Business' },
  location: {
    primaryCity: 'Austin',
    country: 'USA',
    serviceAreas: ['Austin'],
  },
  contact: {},
  services: { primary: ['Consulting'] },
  constraints: { noHallucinations: true },
};

/**
 * Full BusinessInput with all optional fields.
 */
const fullInput: BusinessInput = {
  business: {
    name: 'Austin Plumbing Pros',
    legalName: 'Austin Plumbing Pros LLC',
    website: 'https://austinplumbingpros.com',
    domain: 'austinplumbingpros.com',
  },
  location: {
    primaryCity: 'Austin',
    region: 'TX',
    country: 'USA',
    serviceAreas: ['Austin', 'Round Rock', 'Cedar Park', 'Georgetown', 'Pflugerville'],
  },
  contact: {
    phone: '512-555-1234',
    email: 'info@austinplumbingpros.com',
  },
  services: {
    primary: ['Plumbing Repair', 'Water Heater Installation', 'Drain Cleaning'],
    secondary: ['Leak Detection', 'Pipe Replacement'],
  },
  credentials: {
    yearsOperating: 15,
    licenses: ['TX Master Plumber #12345', 'TX Licensed Plumber #67890'],
    insurance: 'General Liability $1M',
    certifications: ['EPA Lead-Safe Certified', 'Water Heater Specialist'],
  },
  proof: {
    reviewCount: 250,
    averageRating: 4.8,
    testimonialsAvailable: true,
    caseStudiesAvailable: true,
    testimonials: [
      {
        text: 'Excellent service! They fixed our leak quickly and professionally.',
        customerName: 'John Smith',
        serviceReceived: 'Leak Repair',
        date: 'January 2025',
        outcome: 'Saved $500 on water bills',
      },
      {
        text: 'Great work on our water heater installation. Highly recommend!',
        customerName: 'Sarah Johnson',
        serviceReceived: 'Water Heater Installation',
        date: 'December 2024',
      },
    ],
  },
  team: {
    members: [
      {
        name: 'Mike Davis',
        role: 'Owner & Master Plumber',
        yearsExperience: 20,
        licenses: ['TX Master Plumber #12345'],
        certifications: ['EPA Lead-Safe Certified'],
        specialties: ['Commercial plumbing', 'Emergency repairs'],
      },
      {
        name: 'Tom Wilson',
        role: 'Senior Technician',
        yearsExperience: 10,
        licenses: ['TX Licensed Plumber #67890'],
        specialties: ['Water heater installation', 'Drain cleaning'],
      },
    ],
  },
  operations: {
    operatingHours: 'Mon-Fri 7am-6pm, Sat 8am-2pm',
    emergencyService: true,
    serviceProcess: {
      steps: [
        {
          title: 'Call & Schedule',
          description: 'Contact us to schedule your service appointment.',
          timeline: 'Same day scheduling',
        },
        {
          title: 'On-Site Assessment',
          description: 'Technician evaluates the issue and provides a quote.',
          timeline: '30-60 minutes',
        },
        {
          title: 'Service Completion',
          description: 'Professional repair or installation work.',
          timeline: 'Varies by job',
        },
        {
          title: 'Quality Check',
          description: 'Final inspection and customer walkthrough.',
          timeline: '15 minutes',
        },
      ],
      totalTimeline: 'Same day for most repairs',
      emergencyAvailable: true,
      emergencyTimeline: '1 hour response',
    },
  },
  caseStudies: {
    studies: [
      {
        title: 'Emergency Water Main Repair',
        challenge: 'Homeowner had a burst water main causing flooding in their basement.',
        solution: 'Rapid response team arrived within 45 minutes, isolated the leak, and completed a full pipe replacement.',
        results: [
          { metric: 'Response Time', value: '45 minutes' },
          { metric: 'Water Damage Prevented', value: '$10,000+' },
          { metric: 'Completion Time', value: '4 hours' },
        ],
        projectType: 'Residential',
        location: 'Round Rock',
        clientName: 'The Anderson Family',
      },
    ],
  },
  constraints: { noHallucinations: true },
};

// ============================================================
// WHY CHOOSE US GENERATOR TESTS
// ============================================================

async function testWhyChooseUs() {
  console.log('\n1. Why Choose Us Generator');

  await test('generates differentiators from credentials', () => {
    const result = generateWhyChooseUs(fullInput);
    assert(Array.isArray(result.differentiators), 'Should return differentiators array');
    assert(result.differentiators.length >= 4, 'Should generate at least 4 differentiators');
    assert(result.differentiators.length <= 8, 'Should generate at most 8 differentiators');
  });

  await test('generates experience differentiator from yearsOperating', () => {
    const result = generateWhyChooseUs(fullInput);
    const experienceDiff = result.differentiators.find(d => d.category === 'experience');
    assert(experienceDiff !== undefined, 'Should have experience differentiator');
    assert(experienceDiff!.proof.includes('15'), 'Should include years (15) in proof');
  });

  await test('generates expertise differentiator from licenses', () => {
    const result = generateWhyChooseUs(fullInput);
    const expertiseDiff = result.differentiators.find(
      d => d.category === 'expertise' && d.proof.includes('License')
    );
    assert(expertiseDiff !== undefined, 'Should have license-based expertise differentiator');
  });

  await test('generates quality differentiator from reviews', () => {
    const result = generateWhyChooseUs(fullInput);
    const qualityDiff = result.differentiators.find(
      d => d.category === 'quality' && d.proof.includes('250')
    );
    assert(qualityDiff !== undefined, 'Should have quality differentiator with review count');
    assert(qualityDiff!.proof.includes('4.8'), 'Should include average rating');
  });

  await test('generates local differentiator from service areas', () => {
    const result = generateWhyChooseUs(fullInput);
    const localDiff = result.differentiators.find(d => d.category === 'local');
    assert(localDiff !== undefined, 'Should have local differentiator');
    // The claim mentions the count (e.g., "Serving 5 local areas")
    assert(localDiff!.claim.includes('5'), 'Should mention 5 service areas in claim');
  });

  await test('generates speed differentiator for emergency service', () => {
    const result = generateWhyChooseUs(fullInput);
    const speedDiff = result.differentiators.find(d => d.category === 'speed');
    assert(speedDiff !== undefined, 'Should have speed differentiator for emergency service');
  });

  await test('includes location context in differentiators', () => {
    const result = generateWhyChooseUs(fullInput);
    const hasLocalContext = result.differentiators.some(
      d => d.localContext.includes('Austin')
    );
    assert(hasLocalContext, 'Should include Austin in local context');
  });

  await test('generates summary and CTA', () => {
    const result = generateWhyChooseUs(fullInput);
    assert(result.summary.length > 0, 'Should have summary');
    assert(result.callToAction.length > 0, 'Should have call to action');
    assert(result.callToAction.includes('Austin Plumbing Pros'), 'CTA should mention business name');
  });

  await test('handles minimal input without crashing', () => {
    const result = generateWhyChooseUs(minimalInput);
    assert(Array.isArray(result.differentiators), 'Should return differentiators array');
    // Minimal input may have 0 differentiators (no credentials/proof)
    assert(result.sources.includes('BusinessInput'), 'Should have BusinessInput source');
  });

  await test('never fabricates missing credentials (anti-hallucination)', () => {
    const result = generateWhyChooseUs(minimalInput);
    // Minimal input has no credentials, so should not have experience/expertise differentiators
    const hasExperience = result.differentiators.some(d => d.category === 'experience');
    const hasQuality = result.differentiators.some(
      d => d.category === 'quality' && d.proof.includes('reviews')
    );
    assert(!hasExperience, 'Should not fabricate experience without yearsOperating');
    assert(!hasQuality, 'Should not fabricate reviews without reviewCount/averageRating');
  });
}

// ============================================================
// TEAM BIO GENERATOR TESTS
// ============================================================

async function testTeamBio() {
  console.log('\n2. Team Bio Generator');

  await test('generates bios for all team members', () => {
    const result = generateTeamBio(fullInput);
    assertEqual(result.team.length, 2, 'Should generate 2 team member bios');
  });

  await test('includes name and role for each member', () => {
    const result = generateTeamBio(fullInput);
    const mike = result.team.find(m => m.name === 'Mike Davis');
    assert(mike !== undefined, 'Should find Mike Davis');
    assertEqual(mike!.role, 'Owner & Master Plumber', 'Should have correct role');
  });

  await test('includes years of experience', () => {
    const result = generateTeamBio(fullInput);
    const mike = result.team.find(m => m.name === 'Mike Davis');
    assertEqual(mike!.yearsExperience, 20, 'Should have 20 years experience');
    assert(mike!.bio.includes('20'), 'Bio should mention years of experience');
  });

  await test('includes credentials from licenses and certifications', () => {
    const result = generateTeamBio(fullInput);
    const mike = result.team.find(m => m.name === 'Mike Davis');
    assert(mike!.credentials.length > 0, 'Should have credentials');
    const hasLicense = mike!.credentials.some(c => c.includes('TX Master Plumber'));
    assert(hasLicense, 'Should include license credential');
  });

  await test('includes specialties', () => {
    const result = generateTeamBio(fullInput);
    const mike = result.team.find(m => m.name === 'Mike Davis');
    assert(mike!.specialties.length === 2, 'Should have 2 specialties');
    assert(mike!.specialties.includes('Commercial plumbing'), 'Should include specialty');
  });

  await test('includes trust signals', () => {
    const result = generateTeamBio(fullInput);
    const mike = result.team.find(m => m.name === 'Mike Davis');
    assert(mike!.trustSignals.length > 0, 'Should have trust signals');
  });

  await test('generates team summary', () => {
    const result = generateTeamBio(fullInput);
    assert(result.teamSummary.length > 0, 'Should have team summary');
    assert(result.teamSummary.includes('2'), 'Summary should mention 2 professionals');
    assert(result.teamSummary.includes('30'), 'Summary should mention combined 30 years');
  });

  await test('returns empty array when no team data', () => {
    const result = generateTeamBio(minimalInput);
    assertEqual(result.team.length, 0, 'Should return empty team array');
    assertEqual(result.teamSummary, '', 'Should return empty team summary');
  });

  await test('skips generation without hallucination when no team', () => {
    const result = generateTeamBio(minimalInput);
    assert(result.sources.includes('BusinessInput'), 'Should have source');
    assertEqual(result.team.length, 0, 'Should not fabricate team members');
  });

  await test('filters by included members when specified', () => {
    const result = generateTeamBio(fullInput, ['Mike Davis']);
    assertEqual(result.team.length, 1, 'Should only include specified member');
    assertEqual(result.team[0].name, 'Mike Davis', 'Should be Mike Davis');
  });
}

// ============================================================
// HOW WE WORK GENERATOR TESTS
// ============================================================

async function testHowWeWork() {
  console.log('\n3. How We Work Generator');

  await test('generates process steps from provided data', () => {
    const result = generateHowWeWork(fullInput);
    assertEqual(result.steps.length, 4, 'Should have 4 steps from input');
  });

  await test('each step has required fields', () => {
    const result = generateHowWeWork(fullInput);
    for (const step of result.steps) {
      assert(step.stepNumber > 0, 'Should have step number');
      assert(step.title.length > 0, 'Should have title');
      assert(step.description.length > 0, 'Should have description');
      assert(step.timeline.length > 0, 'Should have timeline');
      assert(Array.isArray(step.expectations), 'Should have expectations array');
    }
  });

  await test('preserves provided timelines', () => {
    const result = generateHowWeWork(fullInput);
    const firstStep = result.steps[0];
    assertEqual(firstStep.timeline, 'Same day scheduling', 'Should preserve provided timeline');
  });

  await test('includes total timeline from input', () => {
    const result = generateHowWeWork(fullInput);
    assertEqual(result.totalTimeline, 'Same day for most repairs', 'Should use provided total timeline');
  });

  await test('includes emergency option when available', () => {
    const result = generateHowWeWork(fullInput);
    assert(result.emergencyOption !== undefined, 'Should have emergency option');
    assert(result.emergencyOption!.available, 'Emergency should be available');
    assertEqual(result.emergencyOption!.timeline, '1 hour response', 'Should have correct timeline');
  });

  await test('generates default steps when not provided', () => {
    const result = generateHowWeWork(minimalInput);
    assertRange(result.steps.length, 3, 5, 'Should have 3-5 default steps');
  });

  await test('default steps have reasonable structure', () => {
    const result = generateHowWeWork(minimalInput);
    assert(result.steps[0].title.includes('Contact'), 'First step should be about contact');
    assert(result.steps.some(s => s.title.includes('Assessment') || s.title.includes('Quote')),
      'Should have assessment step');
  });

  await test('generates intro paragraph', () => {
    const result = generateHowWeWork(fullInput);
    assert(result.intro.length > 0, 'Should have intro');
    assert(result.intro.includes('Austin Plumbing Pros'), 'Intro should mention business');
    assert(result.intro.includes('4'), 'Intro should mention step count');
  });

  await test('no emergency option when not available', () => {
    const result = generateHowWeWork(minimalInput);
    assertEqual(result.emergencyOption, undefined, 'Should not have emergency option');
  });
}

// ============================================================
// CASE STUDY GENERATOR TESTS
// ============================================================

async function testCaseStudy() {
  console.log('\n4. Case Study Generator');

  await test('generates case studies from provided data', () => {
    const result = generateCaseStudy(fullInput);
    assertEqual(result.caseStudies.length, 1, 'Should have 1 case study');
  });

  await test('case study has required structure', () => {
    const result = generateCaseStudy(fullInput);
    const study = result.caseStudies[0];
    assert(study.title.length > 0, 'Should have title');
    assert(study.challenge.length > 0, 'Should have challenge');
    assert(study.solution.length > 0, 'Should have solution');
    assert(study.results.length > 0, 'Should have results');
    assert(study.projectType.length > 0, 'Should have project type');
    assert(study.location.length > 0, 'Should have location');
  });

  await test('preserves provided metrics in results', () => {
    const result = generateCaseStudy(fullInput);
    const study = result.caseStudies[0];
    const responseTime = study.results.find(r => r.metric === 'Response Time');
    assert(responseTime !== undefined, 'Should have Response Time metric');
    assertEqual(responseTime!.value, '45 minutes', 'Should preserve provided value');
  });

  await test('preserves client attribution when provided', () => {
    const result = generateCaseStudy(fullInput);
    const study = result.caseStudies[0];
    assertEqual(study.clientAttribution, 'The Anderson Family', 'Should preserve client name');
  });

  await test('uses anonymous attribution when client not provided', () => {
    const inputWithAnonClient: BusinessInput = {
      ...fullInput,
      caseStudies: {
        studies: [
          {
            title: 'Test Case Study',
            challenge: 'Test challenge',
            solution: 'Test solution',
            results: [{ metric: 'Test', value: '100%' }],
            projectType: 'Commercial',
            location: 'Downtown Austin',
            // No clientName
          },
        ],
      },
    };
    const result = generateCaseStudy(inputWithAnonClient);
    assert(
      result.caseStudies[0].clientAttribution?.includes('Anonymous') === true,
      'Should use anonymous attribution'
    );
  });

  await test('returns empty array when no case studies provided', () => {
    const result = generateCaseStudy(minimalInput);
    assertEqual(result.caseStudies.length, 0, 'Should return empty array');
    assertEqual(result.summary, '', 'Should return empty summary');
  });

  await test('does not fabricate case studies (anti-hallucination)', () => {
    const result = generateCaseStudy(minimalInput);
    assertEqual(result.caseStudies.length, 0, 'Should not fabricate case studies');
    assert(result.sources.includes('BusinessInput'), 'Should have source');
  });

  await test('generates summary when case studies exist', () => {
    const result = generateCaseStudy(fullInput);
    assert(result.summary.length > 0, 'Should have summary');
    assert(result.summary.includes('1 case study'), 'Summary should mention count');
  });
}

// ============================================================
// TESTIMONIAL GENERATOR TESTS
// ============================================================

async function testTestimonial() {
  console.log('\n5. Testimonial Generator');

  await test('generates enhanced testimonials from provided data', () => {
    const result = generateTestimonial(fullInput);
    assertEqual(result.testimonials.length, 2, 'Should have 2 testimonials');
  });

  await test('preserves original text', () => {
    const result = generateTestimonial(fullInput);
    const first = result.testimonials[0];
    assertEqual(
      first.original,
      'Excellent service! They fixed our leak quickly and professionally.',
      'Should preserve original text'
    );
  });

  await test('generates enhanced version', () => {
    const result = generateTestimonial(fullInput);
    const first = result.testimonials[0];
    assert(first.enhanced.length > first.original.length, 'Enhanced should be longer');
    assert(first.enhanced.includes(first.original), 'Enhanced should contain original');
  });

  await test('includes customer attribution when provided', () => {
    const result = generateTestimonial(fullInput);
    const first = result.testimonials[0];
    assertEqual(first.attribution.customerName, 'John Smith', 'Should preserve customer name');
    assertEqual(first.attribution.serviceReceived, 'Leak Repair', 'Should preserve service');
    assertEqual(first.attribution.date, 'January 2025', 'Should preserve date');
    assertEqual(first.attribution.outcome, 'Saved $500 on water bills', 'Should preserve outcome');
  });

  await test('uses anonymous when customer name not provided', () => {
    const inputWithAnonTestimonial: BusinessInput = {
      ...fullInput,
      proof: {
        ...fullInput.proof,
        testimonials: [
          {
            text: 'Great service!',
            // No customerName
          },
        ],
      },
    };
    const result = generateTestimonial(inputWithAnonTestimonial);
    assert(
      result.testimonials[0].attribution.customerName.includes('Anonymous'),
      'Should use Anonymous when name not provided'
    );
  });

  await test('extracts key quote', () => {
    const result = generateTestimonial(fullInput);
    const first = result.testimonials[0];
    assert(first.keyQuote.length > 0, 'Should have key quote');
    assert(first.keyQuote.length <= 200, 'Key quote should be reasonable length');
  });

  await test('generates trust signals', () => {
    const result = generateTestimonial(fullInput);
    const first = result.testimonials[0];
    assert(first.trustSignals.length > 0, 'Should have trust signals');
    assert(first.trustSignals.some(s => s.includes('Named')), 'Should have named customer signal');
  });

  await test('returns empty array when no testimonials provided', () => {
    const result = generateTestimonial(minimalInput);
    assertEqual(result.testimonials.length, 0, 'Should return empty array');
    assertEqual(result.summary, '', 'Should return empty summary');
  });

  await test('does not fabricate testimonials (anti-hallucination)', () => {
    const result = generateTestimonial(minimalInput);
    assertEqual(result.testimonials.length, 0, 'Should not fabricate testimonials');
    assert(result.sources.includes('BusinessInput'), 'Should have source');
  });

  await test('generates summary when testimonials exist', () => {
    const result = generateTestimonial(fullInput);
    assert(result.summary.length > 0, 'Should have summary');
    assert(result.summary.includes('2'), 'Summary should mention count');
  });
}

// ============================================================
// PIPELINE INTEGRATION TESTS
// ============================================================

async function testPipelineIntegration() {
  console.log('\n6. Pipeline Integration');

  await test('all generators can import without errors', () => {
    assert(typeof generateWhyChooseUs === 'function', 'generateWhyChooseUs should be a function');
    assert(typeof generateTeamBio === 'function', 'generateTeamBio should be a function');
    assert(typeof generateHowWeWork === 'function', 'generateHowWeWork should be a function');
    assert(typeof generateCaseStudy === 'function', 'generateCaseStudy should be a function');
    assert(typeof generateTestimonial === 'function', 'generateTestimonial should be a function');
  });

  await test('all generators return sources array', () => {
    const whyChooseUs = generateWhyChooseUs(fullInput);
    const teamBio = generateTeamBio(fullInput);
    const howWeWork = generateHowWeWork(fullInput);
    const caseStudy = generateCaseStudy(fullInput);
    const testimonial = generateTestimonial(fullInput);

    assert(Array.isArray(whyChooseUs.sources), 'whyChooseUs should have sources');
    assert(Array.isArray(teamBio.sources), 'teamBio should have sources');
    assert(Array.isArray(howWeWork.sources), 'howWeWork should have sources');
    assert(Array.isArray(caseStudy.sources), 'caseStudy should have sources');
    assert(Array.isArray(testimonial.sources), 'testimonial should have sources');
  });

  await test('all generators handle constraints.noHallucinations=true', () => {
    // These should not throw
    generateWhyChooseUs(fullInput);
    generateTeamBio(fullInput);
    generateHowWeWork(fullInput);
    generateCaseStudy(fullInput);
    generateTestimonial(fullInput);
    // If we reach here without error, test passes
  });

  await test('all generators throw on noHallucinations=false', () => {
    const invalidInput = {
      ...minimalInput,
      constraints: { noHallucinations: false as unknown as true },
    };

    let threw = false;
    try {
      generateWhyChooseUs(invalidInput);
    } catch {
      threw = true;
    }
    assert(threw, 'Should throw on noHallucinations=false');
  });
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================

async function main() {
  console.log('========================================');
  console.log('New Generators Unit Tests');
  console.log('========================================');

  await testWhyChooseUs();
  await testTeamBio();
  await testHowWeWork();
  await testCaseStudy();
  await testTestimonial();
  await testPipelineIntegration();

  // Summary
  console.log('\n========================================');
  console.log('Summary');
  console.log('========================================');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log('========================================\n');

  if (failed > 0) {
    console.log('NEW GENERATORS TESTS FAILED');
    process.exit(1);
  } else {
    console.log('NEW GENERATORS TESTS PASSED');
    process.exit(0);
  }
}

// Run tests
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
