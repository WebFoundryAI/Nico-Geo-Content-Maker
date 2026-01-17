/**
 * Industry-Specific Generators
 *
 * Exports all industry-specific content generators.
 * These generators are conditionally enabled based on detected industry type.
 */

export {
  generatePropertyMarketData,
  type PropertyMarketDataOutput,
} from './propertyMarketData.generator';

export {
  generatePermitsAndCodes,
  type PermitsAndCodesOutput,
} from './permitsAndCodes.generator';

export {
  generateLocalCourtProcess,
  type LocalCourtProcessOutput,
} from './localCourtProcess.generator';

export {
  generateFirstTimeBuyerPrograms,
  type FirstTimeBuyerProgramsOutput,
} from './firstTimeBuyerPrograms.generator';

export {
  generateSeasonalClimate,
  type SeasonalClimateOutput,
} from './seasonalClimate.generator';
