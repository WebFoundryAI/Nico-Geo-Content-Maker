/// <reference types="node" />
/**
 * Unit Tests for Generator Selector System & Industry-Specific Generators
 *
 * Tests for:
 * 1. Generator Registry
 * 2. Generator Selector
 * 3. Property Market Data Generator
 * 4. Permits & Codes Generator
 * 5. Local Court Process Generator
 * 6. First-Time Buyer Programs Generator
 * 7. Seasonal Climate Generator
 *
 * USAGE:
 *   npx ts-node tests/generators/industryGenerators.test.ts
 *
 * EXIT CODES:
 *   0 - All tests passed
 *   1 - One or more tests failed
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  GENERATOR_REGISTRY,
  getGeneratorsByCategory,
  getGeneratorsForIndustry,
  calculateEstimatedTime,
  isValidGenerator,
} from '../../core/generators/registry';
import {
  selectGenerators,
  detectServiceType,
  validateGeneratorPreference,
} from '../../core/generators/selector';
import { generatePropertyMarketData } from '../../core/generators/industry/propertyMarketData.generator';
import { generatePermitsAndCodes } from '../../core/generators/industry/permitsAndCodes.generator';
import { generateLocalCourtProcess } from '../../core/generators/industry/localCourtProcess.generator';
import { generateFirstTimeBuyerPrograms } from '../../core/generators/industry/firstTimeBuyerPrograms.generator';
import { generateSeasonalClimate } from '../../core/generators/industry/seasonalClimate.generator';

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
 * Asserts array contains a value.
 */
function assertIncludes<T>(arr: T[], value: T, message: string): void {
  if (!arr.includes(value)) {
    throw new Error(`${message}: expected to include ${value}`);
  }
}

/**
 * Asserts array does not contain a value.
 */
function assertNotIncludes<T>(arr: T[], value: T, message: string): void {
  if (arr.includes(value)) {
    throw new Error(`${message}: expected not to include ${value}`);
  }
}

// ============================================================
// TEST FIXTURES
// ============================================================

/**
 * Minimal valid BusinessInput.
 */
const minimalInput: BusinessInput = {
  business: { name: 'Test Business' },
  location: {
    primaryCity: 'Austin',
    region: 'Texas',
    country: 'USA',
    serviceAreas: ['Austin', 'Round Rock'],
  },
  contact: {},
  services: { primary: ['Consulting'] },
  constraints: { noHallucinations: true },
};

/**
 * Real estate business input.
 */
const realEstateInput: BusinessInput = {
  business: { name: 'Austin Realty Group' },
  location: {
    primaryCity: 'Austin',
    region: 'Texas',
    country: 'USA',
    serviceAreas: ['Austin', 'Round Rock', 'Cedar Park', 'Pflugerville'],
  },
  contact: { phone: '555-0100' },
  services: { primary: ['Real Estate Sales', 'Buyer Representation'] },
  constraints: { noHallucinations: true },
};

/**
 * Plumbing business input.
 */
const plumbingInput: BusinessInput = {
  business: { name: 'Austin Plumbing Pros' },
  location: {
    primaryCity: 'Austin',
    region: 'Texas',
    country: 'USA',
    serviceAreas: ['Austin', 'Round Rock'],
  },
  contact: { phone: '555-0200' },
  services: { primary: ['Plumbing Repair', 'Water Heater Installation', 'Drain Cleaning'] },
  credentials: {
    yearsOperating: 15,
    licenses: ['Texas Master Plumber #12345'],
  },
  constraints: { noHallucinations: true },
};

/**
 * Law firm business input.
 */
const lawFirmInput: BusinessInput = {
  business: { name: 'Smith & Associates Law Firm' },
  location: {
    primaryCity: 'Dallas',
    region: 'Texas',
    country: 'USA',
    serviceAreas: ['Dallas', 'Fort Worth', 'Plano'],
  },
  contact: { phone: '555-0300' },
  services: { primary: ['Personal Injury', 'Family Law', 'Criminal Defense'] },
  constraints: { noHallucinations: true },
};

/**
 * HVAC business input.
 */
const hvacInput: BusinessInput = {
  business: { name: 'Cool Comfort HVAC' },
  location: {
    primaryCity: 'Phoenix',
    region: 'Arizona',
    country: 'USA',
    serviceAreas: ['Phoenix', 'Scottsdale', 'Mesa'],
  },
  contact: { phone: '555-0400' },
  services: { primary: ['HVAC Installation', 'AC Repair', 'Heating Services'] },
  constraints: { noHallucinations: true },
};

/**
 * Pool service business input.
 */
const poolInput: BusinessInput = {
  business: { name: 'Crystal Clear Pools' },
  location: {
    primaryCity: 'Miami',
    region: 'Florida',
    country: 'USA',
    serviceAreas: ['Miami', 'Fort Lauderdale'],
  },
  contact: { phone: '555-0500' },
  services: { primary: ['Pool Cleaning', 'Pool Maintenance', 'Pool Repair'] },
  constraints: { noHallucinations: true },
};

// ============================================================
// 1. GENERATOR REGISTRY TESTS
// ============================================================

async function testRegistry() {
  console.log('\n1. Generator Registry');

  await test('has all core generators', () => {
    const coreGenerators = getGeneratorsByCategory('core');
    assertIncludes(coreGenerators, 'titleMeta', 'Missing titleMeta');
    assertIncludes(coreGenerators, 'answerCapsule', 'Missing answerCapsule');
    assertIncludes(coreGenerators, 'serviceDescription', 'Missing serviceDescription');
    assertIncludes(coreGenerators, 'whyChooseUs', 'Missing whyChooseUs');
    assertIncludes(coreGenerators, 'teamBio', 'Missing teamBio');
    assertIncludes(coreGenerators, 'howWeWork', 'Missing howWeWork');
    assertIncludes(coreGenerators, 'caseStudy', 'Missing caseStudy');
    assertIncludes(coreGenerators, 'testimonial', 'Missing testimonial');
    assertIncludes(coreGenerators, 'faq', 'Missing faq');
    assertIncludes(coreGenerators, 'schema', 'Missing schema');
  });

  await test('has all industry generators', () => {
    const industryGenerators = getGeneratorsByCategory('industry');
    assertIncludes(industryGenerators, 'propertyMarketData', 'Missing propertyMarketData');
    assertIncludes(industryGenerators, 'permitsAndCodes', 'Missing permitsAndCodes');
    assertIncludes(industryGenerators, 'localCourtProcess', 'Missing localCourtProcess');
    assertIncludes(industryGenerators, 'firstTimeBuyerPrograms', 'Missing firstTimeBuyerPrograms');
    assertIncludes(industryGenerators, 'seasonalClimate', 'Missing seasonalClimate');
  });

  await test('returns correct generators for real estate industry', () => {
    const generators = getGeneratorsForIndustry('realEstate');
    assertIncludes(generators, 'titleMeta', 'Should include core generators');
    assertIncludes(generators, 'propertyMarketData', 'Should include propertyMarketData');
    assertIncludes(generators, 'firstTimeBuyerPrograms', 'Should include firstTimeBuyerPrograms');
    assertNotIncludes(generators, 'permitsAndCodes', 'Should not include permitsAndCodes');
    assertNotIncludes(generators, 'localCourtProcess', 'Should not include localCourtProcess');
  });

  await test('returns correct generators for plumbing industry', () => {
    const generators = getGeneratorsForIndustry('plumbing');
    assertIncludes(generators, 'permitsAndCodes', 'Should include permitsAndCodes');
    assertNotIncludes(generators, 'propertyMarketData', 'Should not include propertyMarketData');
    assertNotIncludes(generators, 'localCourtProcess', 'Should not include localCourtProcess');
  });

  await test('returns correct generators for lawyer industry', () => {
    const generators = getGeneratorsForIndustry('lawyer');
    assertIncludes(generators, 'localCourtProcess', 'Should include localCourtProcess');
    assertNotIncludes(generators, 'propertyMarketData', 'Should not include propertyMarketData');
    assertNotIncludes(generators, 'seasonalClimate', 'Should not include seasonalClimate');
  });

  await test('calculates estimated time correctly', () => {
    const time = calculateEstimatedTime(['titleMeta', 'answerCapsule']);
    assert(time > 0, 'Time should be positive');
    assert(time === 4000, 'Time should be 2000 + 2000 = 4000');
  });

  await test('validates generator IDs', () => {
    assert(isValidGenerator('titleMeta'), 'titleMeta should be valid');
    assert(isValidGenerator('propertyMarketData'), 'propertyMarketData should be valid');
    assert(!isValidGenerator('invalidGenerator'), 'invalidGenerator should not be valid');
  });
}

// ============================================================
// 2. GENERATOR SELECTOR TESTS
// ============================================================

async function testSelector() {
  console.log('\n2. Generator Selector');

  await test('detects real estate from services', () => {
    const industry = detectServiceType(realEstateInput);
    assert(industry === 'realEstate', `Expected realEstate, got ${industry}`);
  });

  await test('detects plumbing from services', () => {
    const industry = detectServiceType(plumbingInput);
    assert(industry === 'plumbing', `Expected plumbing, got ${industry}`);
  });

  await test('detects lawyer from services', () => {
    const industry = detectServiceType(lawFirmInput);
    assert(industry === 'lawyer', `Expected lawyer, got ${industry}`);
  });

  await test('detects hvac from services', () => {
    const industry = detectServiceType(hvacInput);
    assert(industry === 'hvac', `Expected hvac, got ${industry}`);
  });

  await test('detects pools from services', () => {
    const industry = detectServiceType(poolInput);
    assert(industry === 'pools', `Expected pools, got ${industry}`);
  });

  await test('returns general for unknown services', () => {
    const industry = detectServiceType(minimalInput);
    assert(industry === 'general', `Expected general, got ${industry}`);
  });

  await test('selects generators with autoDetect for real estate', async () => {
    const selection = await selectGenerators(realEstateInput);
    assert(selection.autoDetect === true, 'autoDetect should be true');
    assert(selection.detectedIndustry === 'realEstate', 'Should detect realEstate');
    assertIncludes(selection.enabled, 'propertyMarketData', 'Should include propertyMarketData');
    assertIncludes(selection.enabled, 'firstTimeBuyerPrograms', 'Should include firstTimeBuyerPrograms');
  });

  await test('selects generators with autoDetect for plumbing', async () => {
    const selection = await selectGenerators(plumbingInput);
    assert(selection.detectedIndustry === 'plumbing', 'Should detect plumbing');
    assertIncludes(selection.enabled, 'permitsAndCodes', 'Should include permitsAndCodes');
  });

  await test('respects explicit enabled array', async () => {
    const selection = await selectGenerators(realEstateInput, {
      enabled: ['titleMeta', 'answerCapsule'],
    });
    assert(selection.autoDetect === false, 'autoDetect should be false');
    assert(selection.enabled.length === 2, 'Should have exactly 2 generators');
    assertIncludes(selection.enabled, 'titleMeta', 'Should include titleMeta');
    assertIncludes(selection.enabled, 'answerCapsule', 'Should include answerCapsule');
  });

  await test('respects disabled array', async () => {
    const selection = await selectGenerators(realEstateInput, {
      disabled: ['propertyMarketData'],
    });
    assertNotIncludes(selection.enabled, 'propertyMarketData', 'Should not include propertyMarketData');
  });

  await test('returns core only when autoDetect is false', async () => {
    const selection = await selectGenerators(realEstateInput, { autoDetect: false });
    assertNotIncludes(selection.enabled, 'propertyMarketData', 'Should not include industry generator');
    assertIncludes(selection.enabled, 'titleMeta', 'Should include core generator');
  });

  await test('validates generator preferences', () => {
    const errors1 = validateGeneratorPreference({ enabled: ['titleMeta'] });
    assert(errors1.length === 0, 'Valid preference should have no errors');

    const errors2 = validateGeneratorPreference({ enabled: ['invalidGenerator'] });
    assert(errors2.length > 0, 'Invalid generator should produce error');
  });
}

// ============================================================
// 3. PROPERTY MARKET DATA GENERATOR TESTS
// ============================================================

async function testPropertyMarketData() {
  console.log('\n3. Property Market Data Generator');

  await test('generates output for real estate input', () => {
    const output = generatePropertyMarketData(realEstateInput);
    assert(output !== null, 'Output should not be null');
    assert(output.location.includes('Austin'), 'Should include location');
    assert(output.marketOverview !== null, 'Should have market overview');
    assert(output.trends.length > 0, 'Should have trends');
    assert(output.sources.includes('BusinessInput'), 'Should include BusinessInput source');
  });

  await test('generates hot areas from service areas', () => {
    const output = generatePropertyMarketData(realEstateInput);
    assert(output.hotAreas.length > 0, 'Should have hot areas');
    assert(output.hotAreas[0].name !== '', 'Hot area should have name');
  });

  await test('includes price ranges', () => {
    const output = generatePropertyMarketData(realEstateInput);
    assert(output.priceRanges.length > 0, 'Should have price ranges');
    assert(output.priceRanges[0].range !== '', 'Price range should have value');
  });

  await test('includes disclaimer', () => {
    const output = generatePropertyMarketData(realEstateInput);
    assert(output.disclaimer.length > 0, 'Should have disclaimer');
    assert(output.disclaimer.includes('Austin'), 'Disclaimer should mention location');
  });

  await test('enforces anti-hallucination', () => {
    const badInput = { ...realEstateInput, constraints: { noHallucinations: false } as never };
    try {
      generatePropertyMarketData(badInput);
      assert(false, 'Should throw for noHallucinations: false');
    } catch (err) {
      assert(err instanceof Error, 'Should throw Error');
    }
  });
}

// ============================================================
// 4. PERMITS & CODES GENERATOR TESTS
// ============================================================

async function testPermitsAndCodes() {
  console.log('\n4. Permits & Codes Generator');

  await test('generates output for plumbing input', () => {
    const output = generatePermitsAndCodes(plumbingInput);
    assert(output !== null, 'Output should not be null');
    assert(output.jurisdiction.includes('Austin'), 'Should include jurisdiction');
    assert(output.permits.length > 0, 'Should have permits');
    assert(output.buildingCodes.length > 0, 'Should have building codes');
  });

  await test('includes plumbing-specific permits', () => {
    const output = generatePermitsAndCodes(plumbingInput);
    const hasPlumbingPermit = output.permits.some(p =>
      p.permitType.toLowerCase().includes('plumb')
    );
    assert(hasPlumbingPermit, 'Should include plumbing permit');
  });

  await test('includes inspection requirements', () => {
    const output = generatePermitsAndCodes(plumbingInput);
    assert(output.inspectionRequirements.length > 0, 'Should have inspection requirements');
  });

  await test('includes licensing requirements', () => {
    const output = generatePermitsAndCodes(plumbingInput);
    assert(output.licensingRequirements.length > 0, 'Should have licensing requirements');
  });

  await test('generates output for HVAC input', () => {
    const output = generatePermitsAndCodes(hvacInput);
    const hasMechanicalPermit = output.permits.some(p =>
      p.permitType.toLowerCase().includes('mechanical')
    );
    assert(hasMechanicalPermit, 'Should include mechanical permit for HVAC');
  });

  await test('includes disclaimer', () => {
    const output = generatePermitsAndCodes(plumbingInput);
    assert(output.disclaimer.length > 0, 'Should have disclaimer');
  });
}

// ============================================================
// 5. LOCAL COURT PROCESS GENERATOR TESTS
// ============================================================

async function testLocalCourtProcess() {
  console.log('\n5. Local Court Process Generator');

  await test('generates output for law firm input', () => {
    const output = generateLocalCourtProcess(lawFirmInput);
    assert(output !== null, 'Output should not be null');
    assert(output.jurisdiction.includes('Dallas'), 'Should include jurisdiction');
    assert(output.courtSystem.includes('Texas'), 'Should include state in court system');
  });

  await test('detects practice areas from services', () => {
    const output = generateLocalCourtProcess(lawFirmInput);
    assert(output.practiceAreas.length > 0, 'Should have practice areas');
    const areas = output.practiceAreas.map(p => p.area.toLowerCase());
    assert(
      areas.some(a => a.includes('personal injury') || a.includes('family') || a.includes('criminal')),
      'Should detect relevant practice areas'
    );
  });

  await test('includes filing information', () => {
    const output = generateLocalCourtProcess(lawFirmInput);
    assert(output.filingInformation.length > 0, 'Should have filing information');
  });

  await test('includes court locations', () => {
    const output = generateLocalCourtProcess(lawFirmInput);
    assert(output.courtLocations.length > 0, 'Should have court locations');
  });

  await test('includes important deadlines', () => {
    const output = generateLocalCourtProcess(lawFirmInput);
    assert(output.importantDeadlines.length > 0, 'Should have important deadlines');
  });

  await test('includes disclaimer', () => {
    const output = generateLocalCourtProcess(lawFirmInput);
    assert(output.disclaimer.length > 0, 'Should have disclaimer');
    assert(output.disclaimer.includes('Dallas'), 'Disclaimer should mention location');
  });
}

// ============================================================
// 6. FIRST-TIME BUYER PROGRAMS GENERATOR TESTS
// ============================================================

async function testFirstTimeBuyerPrograms() {
  console.log('\n6. First-Time Buyer Programs Generator');

  await test('generates output for real estate input', () => {
    const output = generateFirstTimeBuyerPrograms(realEstateInput);
    assert(output !== null, 'Output should not be null');
    assert(output.location.includes('Austin'), 'Should include location');
  });

  await test('includes federal programs', () => {
    const output = generateFirstTimeBuyerPrograms(realEstateInput);
    assert(output.federalPrograms.length > 0, 'Should have federal programs');
    const programNames = output.federalPrograms.map(p => p.name.toLowerCase());
    assert(programNames.some(n => n.includes('fha')), 'Should include FHA program');
    assert(programNames.some(n => n.includes('va')), 'Should include VA program');
  });

  await test('includes state programs', () => {
    const output = generateFirstTimeBuyerPrograms(realEstateInput);
    assert(output.statePrograms.length > 0, 'Should have state programs');
    assert(
      output.statePrograms.some(p => p.name.includes('Texas')),
      'State programs should reference state'
    );
  });

  await test('includes local programs', () => {
    const output = generateFirstTimeBuyerPrograms(realEstateInput);
    assert(output.localPrograms.length > 0, 'Should have local programs');
  });

  await test('includes tax credits', () => {
    const output = generateFirstTimeBuyerPrograms(realEstateInput);
    assert(output.taxCredits.length > 0, 'Should have tax credits');
  });

  await test('includes disclaimer', () => {
    const output = generateFirstTimeBuyerPrograms(realEstateInput);
    assert(output.disclaimer.length > 0, 'Should have disclaimer');
  });
}

// ============================================================
// 7. SEASONAL CLIMATE GENERATOR TESTS
// ============================================================

async function testSeasonalClimate() {
  console.log('\n7. Seasonal Climate Generator');

  await test('generates output for HVAC input', () => {
    const output = generateSeasonalClimate(hvacInput);
    assert(output !== null, 'Output should not be null');
    assert(output.location.includes('Phoenix'), 'Should include location');
    assert(output.climateZone !== null, 'Should have climate zone');
  });

  await test('detects climate zone', () => {
    const output = generateSeasonalClimate(hvacInput);
    assert(output.climateZone.zone.length > 0, 'Should have climate zone name');
    assert(output.climateZone.characteristics.length > 0, 'Should have characteristics');
  });

  await test('includes seasonal timings', () => {
    const output = generateSeasonalClimate(hvacInput);
    assert(output.seasonalTimings.length === 4, 'Should have 4 seasons');
    const seasons = output.seasonalTimings.map(s => s.season);
    assertIncludes(seasons, 'spring', 'Should include spring');
    assertIncludes(seasons, 'summer', 'Should include summer');
    assertIncludes(seasons, 'fall', 'Should include fall');
    assertIncludes(seasons, 'winter', 'Should include winter');
  });

  await test('includes maintenance schedule', () => {
    const output = generateSeasonalClimate(hvacInput);
    assert(output.maintenanceSchedule.length > 0, 'Should have maintenance schedule');
  });

  await test('includes energy efficiency tips', () => {
    const output = generateSeasonalClimate(hvacInput);
    assert(output.energyEfficiencyTips.length > 0, 'Should have energy efficiency tips');
  });

  await test('generates pool-specific content for pool business', () => {
    const output = generateSeasonalClimate(poolInput);
    const summerServices = output.seasonalTimings.find(s => s.season === 'summer');
    assert(summerServices !== undefined, 'Should have summer timing');
    const serviceNames = summerServices!.services.map(s => s.name.toLowerCase());
    assert(
      serviceNames.some(n => n.includes('pool') || n.includes('maintenance')),
      'Should have pool-related services'
    );
  });

  await test('includes disclaimer', () => {
    const output = generateSeasonalClimate(hvacInput);
    assert(output.disclaimer.length > 0, 'Should have disclaimer');
  });
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log('Generator Selector System & Industry Generators Tests');
  console.log('='.repeat(60));

  await testRegistry();
  await testSelector();
  await testPropertyMarketData();
  await testPermitsAndCodes();
  await testLocalCourtProcess();
  await testFirstTimeBuyerPrograms();
  await testSeasonalClimate();

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
