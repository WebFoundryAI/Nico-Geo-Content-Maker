/**
 * Seasonal & Climate Generator
 *
 * Generates seasonal service timing, weather patterns, and maintenance
 * schedules for weather-dependent service businesses.
 *
 * INDUSTRIES: HVAC, Roofing, Landscaping, Pools
 *
 * DATA SOURCE STRATEGY:
 * - Uses general climate zone templates
 * - Provides typical seasonal patterns
 * - Future enhancement: integrate with weather/climate APIs
 *
 * ANTI-HALLUCINATION:
 * - Never fabricates specific weather data
 * - Uses clearly labeled template/general information
 * - All output includes disclaimer about local variations
 */

import type { BusinessInput } from '../../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
} from '../../rules/antiHallucination';
import type {
  SeasonalClimateContract,
  SeasonalTiming,
  ClimateZoneInfo,
} from '../../../contracts/output.contract';

/**
 * Output type for the Seasonal Climate generator.
 */
export type SeasonalClimateOutput = SeasonalClimateContract;

/**
 * Trade-specific seasonal data.
 */
interface TradeSeasonalData {
  seasonalTimings: SeasonalTiming[];
  maintenanceSchedule: SeasonalClimateOutput['maintenanceSchedule'];
  energyEfficiencyTips: SeasonalClimateOutput['energyEfficiencyTips'];
}

/**
 * Climate zone templates based on general US climate regions.
 */
const CLIMATE_ZONES: Record<string, ClimateZoneInfo> = {
  hotHumid: {
    zone: 'Hot-Humid Climate',
    characteristics: [
      'High temperatures and humidity for much of the year',
      'Mild winters with occasional cold snaps',
      'Significant cooling needs from spring through fall',
      'Heavy rainfall and potential for hurricanes',
    ],
    challenges: [
      'High humidity can stress HVAC systems',
      'Mold and mildew prevention important',
      'Intense UV exposure degrades materials faster',
      'Hurricane/storm damage potential',
    ],
    recommendations: [
      'Regular HVAC maintenance and dehumidification',
      'UV-resistant roofing materials',
      'Hurricane-resistant construction',
      'Proper drainage systems',
    ],
  },
  hotDry: {
    zone: 'Hot-Dry Climate',
    characteristics: [
      'Intense summer heat with low humidity',
      'Mild to cool winters',
      'Significant day/night temperature swings',
      'Low annual precipitation',
    ],
    challenges: [
      'Extreme heat stresses all systems',
      'UV exposure very intense',
      'Dust and debris accumulation',
      'Water scarcity for landscaping',
    ],
    recommendations: [
      'High-efficiency cooling systems',
      'Reflective roofing materials',
      'Drought-tolerant landscaping',
      'Pool covers to prevent evaporation',
    ],
  },
  mixedHumid: {
    zone: 'Mixed-Humid Climate',
    characteristics: [
      'Distinct four seasons',
      'Hot, humid summers',
      'Cold winters with occasional snow',
      'Moderate precipitation year-round',
    ],
    challenges: [
      'Wide temperature range stresses materials',
      'Freeze-thaw cycles damage surfaces',
      'Both heating and cooling needs significant',
      'Seasonal transitions require preparation',
    ],
    recommendations: [
      'Dual heating/cooling systems',
      'Weather-resistant roofing',
      'Seasonal HVAC tune-ups',
      'Proper winterization procedures',
    ],
  },
  cold: {
    zone: 'Cold Climate',
    characteristics: [
      'Long, cold winters with significant snow',
      'Short, mild summers',
      'Extended heating season',
      'Freeze-thaw cycles common',
    ],
    challenges: [
      'Heavy snow and ice loads',
      'Frozen pipes and equipment',
      'High heating costs',
      'Limited outdoor work season',
    ],
    recommendations: [
      'High-efficiency heating systems',
      'Ice dam prevention for roofs',
      'Winterization of all outdoor systems',
      'Cold-weather rated equipment',
    ],
  },
  marine: {
    zone: 'Marine Climate',
    characteristics: [
      'Mild temperatures year-round',
      'Significant cloud cover and precipitation',
      'Cool summers and mild winters',
      'Consistent humidity levels',
    ],
    challenges: [
      'Constant moisture exposure',
      'Moss and algae growth on roofs',
      'Rust and corrosion issues',
      'Limited sunny days for solar',
    ],
    recommendations: [
      'Moisture-resistant materials',
      'Regular roof cleaning and treatment',
      'Corrosion-resistant equipment',
      'Dehumidification systems',
    ],
  },
  default: {
    zone: 'Temperate Climate',
    characteristics: [
      'Moderate temperatures throughout the year',
      'Distinct seasons with gradual transitions',
      'Average precipitation levels',
      'Balanced heating and cooling needs',
    ],
    challenges: [
      'Seasonal maintenance required',
      'Temperature transitions affect systems',
      'Varying weather conditions',
      'Storm potential in any season',
    ],
    recommendations: [
      'Regular seasonal maintenance',
      'Versatile heating/cooling systems',
      'Weather-monitoring practices',
      'Proper drainage systems',
    ],
  },
};

/**
 * HVAC-specific seasonal data.
 */
const HVAC_SEASONAL_DATA: TradeSeasonalData = {
  seasonalTimings: [
    {
      season: 'spring',
      months: ['March', 'April', 'May'],
      services: [
        { name: 'AC Tune-up', priority: 'essential', reason: 'Prepare cooling system before summer heat', idealTiming: 'Early to mid-spring' },
        { name: 'Filter Replacement', priority: 'essential', reason: 'Ensure clean air and system efficiency', idealTiming: 'Start of season' },
        { name: 'Duct Cleaning', priority: 'recommended', reason: 'Remove winter buildup before cooling season', idealTiming: 'After heating season ends' },
      ],
      weatherConsiderations: ['Mild weather ideal for outdoor unit work', 'Schedule before summer rush'],
    },
    {
      season: 'summer',
      months: ['June', 'July', 'August'],
      services: [
        { name: 'Emergency AC Repair', priority: 'essential', reason: 'Peak demand for cooling failures', idealTiming: 'As needed (busy season)' },
        { name: 'Refrigerant Check', priority: 'recommended', reason: 'Ensure optimal cooling capacity', idealTiming: 'During service calls' },
        { name: 'New Installation', priority: 'optional', reason: 'Longer wait times during peak season', idealTiming: 'Consider scheduling for fall' },
      ],
      weatherConsiderations: ['High demand may mean longer wait times', 'Heat emergencies are priority'],
    },
    {
      season: 'fall',
      months: ['September', 'October', 'November'],
      services: [
        { name: 'Heating System Tune-up', priority: 'essential', reason: 'Prepare furnace before winter cold', idealTiming: 'Early to mid-fall' },
        { name: 'Heat Pump Inspection', priority: 'essential', reason: 'Ensure proper heating mode operation', idealTiming: 'Before first freeze' },
        { name: 'New System Installation', priority: 'recommended', reason: 'Slower season with better availability', idealTiming: 'Ideal time for upgrades' },
      ],
      weatherConsiderations: ['Best time for major installations', 'Test heating before cold arrives'],
    },
    {
      season: 'winter',
      months: ['December', 'January', 'February'],
      services: [
        { name: 'Emergency Heating Repair', priority: 'essential', reason: 'Heating failures are critical', idealTiming: 'Immediate response needed' },
        { name: 'Filter Replacement', priority: 'essential', reason: 'High furnace use requires clean filters', idealTiming: 'Monthly during heavy use' },
        { name: 'Indoor Air Quality', priority: 'recommended', reason: 'Closed homes need air quality attention', idealTiming: 'Throughout winter' },
      ],
      weatherConsiderations: ['No-heat emergencies are top priority', 'Outdoor work limited by weather'],
    },
  ],
  maintenanceSchedule: [
    { frequency: 'monthly', tasks: ['Replace or check air filters', 'Check thermostat operation', 'Clear around outdoor units'], bestMonths: ['All months'] },
    { frequency: 'semi-annual', tasks: ['Professional tune-up (AC in spring, heating in fall)', 'Clean evaporator and condenser coils', 'Check refrigerant levels'], bestMonths: ['March/April', 'September/October'] },
    { frequency: 'annual', tasks: ['Duct inspection and cleaning', 'Blower motor lubrication', 'Safety inspection of all components'], bestMonths: ['Spring or Fall'] },
  ],
  energyEfficiencyTips: [
    { season: 'Summer', tips: ['Set thermostat to 78°F when home', 'Use ceiling fans to feel cooler', 'Close blinds during peak sun hours', 'Avoid heat-generating appliances midday'], estimatedSavings: '10-20% on cooling costs' },
    { season: 'Winter', tips: ['Set thermostat to 68°F when home', 'Lower temperature at night and when away', 'Seal air leaks around windows and doors', 'Use programmable or smart thermostat'], estimatedSavings: '10-15% on heating costs' },
  ],
};

/**
 * Roofing-specific seasonal data.
 */
const ROOFING_SEASONAL_DATA: TradeSeasonalData = {
  seasonalTimings: [
    {
      season: 'spring',
      months: ['March', 'April', 'May'],
      services: [
        { name: 'Post-Winter Inspection', priority: 'essential', reason: 'Check for winter storm damage', idealTiming: 'After last freeze' },
        { name: 'Gutter Cleaning', priority: 'essential', reason: 'Clear winter debris before spring rains', idealTiming: 'Early spring' },
        { name: 'Roof Repairs', priority: 'recommended', reason: 'Ideal weather for repairs', idealTiming: 'Mid to late spring' },
      ],
      weatherConsiderations: ['Watch for late-season storms', 'Best weather for shingle work'],
    },
    {
      season: 'summer',
      months: ['June', 'July', 'August'],
      services: [
        { name: 'Full Roof Replacement', priority: 'recommended', reason: 'Long days and good weather', idealTiming: 'Early summer preferred' },
        { name: 'Attic Ventilation', priority: 'recommended', reason: 'Address heat buildup issues', idealTiming: 'During roof work' },
        { name: 'Storm Damage Repair', priority: 'essential', reason: 'Summer storms can cause damage', idealTiming: 'After any storm' },
      ],
      weatherConsiderations: ['Extreme heat can affect materials', 'Morning work preferred in heat'],
    },
    {
      season: 'fall',
      months: ['September', 'October', 'November'],
      services: [
        { name: 'Pre-Winter Inspection', priority: 'essential', reason: 'Identify issues before winter', idealTiming: 'Early to mid-fall' },
        { name: 'Gutter Cleaning', priority: 'essential', reason: 'Clear leaves before winter', idealTiming: 'After leaves fall' },
        { name: 'Roof Replacement', priority: 'recommended', reason: 'Last chance before winter', idealTiming: 'Before consistent cold' },
      ],
      weatherConsiderations: ['Must complete before freezing temps', 'Shorter days limit work hours'],
    },
    {
      season: 'winter',
      months: ['December', 'January', 'February'],
      services: [
        { name: 'Emergency Repairs', priority: 'essential', reason: 'Active leaks need immediate attention', idealTiming: 'As needed' },
        { name: 'Ice Dam Prevention', priority: 'recommended', reason: 'Prevent costly damage', idealTiming: 'Before heavy snow' },
        { name: 'Planning for Spring', priority: 'optional', reason: 'Get quotes and schedule early', idealTiming: 'Late winter' },
      ],
      weatherConsiderations: ['Major work usually not possible', 'Emergency repairs weather-dependent'],
    },
  ],
  maintenanceSchedule: [
    { frequency: 'semi-annual', tasks: ['Visual roof inspection', 'Gutter cleaning', 'Check flashing and seals'], bestMonths: ['April', 'October'] },
    { frequency: 'annual', tasks: ['Professional roof inspection', 'Attic ventilation check', 'Moss/algae treatment if needed'], bestMonths: ['Spring or Fall'] },
  ],
  energyEfficiencyTips: [
    { season: 'Summer', tips: ['Light-colored roofing reflects heat', 'Proper attic ventilation reduces cooling costs', 'Radiant barriers can reduce heat gain'], estimatedSavings: '10-25% on cooling costs' },
    { season: 'Winter', tips: ['Proper insulation prevents heat loss', 'Good ventilation prevents ice dams', 'Sealed roof penetrations prevent air leaks'], estimatedSavings: '10-20% on heating costs' },
  ],
};

/**
 * Landscaping-specific seasonal data.
 */
const LANDSCAPING_SEASONAL_DATA: TradeSeasonalData = {
  seasonalTimings: [
    {
      season: 'spring',
      months: ['March', 'April', 'May'],
      services: [
        { name: 'Spring Cleanup', priority: 'essential', reason: 'Remove winter debris and prep beds', idealTiming: 'When ground thaws' },
        { name: 'Mulching', priority: 'essential', reason: 'Protect plants and retain moisture', idealTiming: 'After cleanup' },
        { name: 'Planting', priority: 'recommended', reason: 'Ideal time for new plantings', idealTiming: 'After last frost' },
        { name: 'Lawn Aeration', priority: 'recommended', reason: 'Relieve soil compaction', idealTiming: 'Early spring for cool-season grass' },
      ],
      weatherConsiderations: ['Wait for soil to dry out', 'Watch for late frosts before planting'],
    },
    {
      season: 'summer',
      months: ['June', 'July', 'August'],
      services: [
        { name: 'Regular Mowing', priority: 'essential', reason: 'Weekly mowing during peak growth', idealTiming: 'Weekly schedule' },
        { name: 'Irrigation Management', priority: 'essential', reason: 'Proper watering during heat', idealTiming: 'Early morning watering' },
        { name: 'Pest/Disease Control', priority: 'recommended', reason: 'Peak season for lawn issues', idealTiming: 'As needed' },
      ],
      weatherConsiderations: ['Avoid major planting in heat', 'Deep watering less frequently is best'],
    },
    {
      season: 'fall',
      months: ['September', 'October', 'November'],
      services: [
        { name: 'Fall Cleanup', priority: 'essential', reason: 'Remove leaves and prepare for winter', idealTiming: 'After leaves fall' },
        { name: 'Overseeding', priority: 'recommended', reason: 'Best time for lawn seeding', idealTiming: 'Early fall' },
        { name: 'Fall Fertilization', priority: 'recommended', reason: 'Strengthen roots for winter', idealTiming: 'Late fall' },
        { name: 'Tree/Shrub Planting', priority: 'recommended', reason: 'Ideal conditions for establishment', idealTiming: 'Early to mid-fall' },
      ],
      weatherConsiderations: ['Plant before ground freezes', 'Last chance for major plantings'],
    },
    {
      season: 'winter',
      months: ['December', 'January', 'February'],
      services: [
        { name: 'Winter Pruning', priority: 'recommended', reason: 'Dormant season ideal for pruning', idealTiming: 'Late winter preferred' },
        { name: 'Snow Removal', priority: 'essential', reason: 'Clear walkways and driveways', idealTiming: 'As needed' },
        { name: 'Planning', priority: 'optional', reason: 'Design new projects for spring', idealTiming: 'Throughout winter' },
      ],
      weatherConsiderations: ['Limited outdoor work possible', 'Focus on hardscape planning'],
    },
  ],
  maintenanceSchedule: [
    { frequency: 'monthly', tasks: ['Lawn mowing (growing season)', 'Weed control', 'Check irrigation systems'], bestMonths: ['April through October'] },
    { frequency: 'quarterly', tasks: ['Fertilization', 'Seasonal color rotation', 'Pruning'], bestMonths: ['March', 'June', 'September', 'December'] },
    { frequency: 'annual', tasks: ['Core aeration', 'Overseeding', 'Major pruning', 'Irrigation winterization'], bestMonths: ['Spring and Fall'] },
  ],
  energyEfficiencyTips: [
    { season: 'Summer', tips: ['Strategic tree placement provides natural shade', 'Proper mulching reduces water needs', 'Drought-tolerant plants reduce irrigation'], estimatedSavings: '15-30% on cooling and water costs' },
    { season: 'Winter', tips: ['Evergreen windbreaks reduce heating needs', 'Deciduous trees allow winter sun through', 'Proper drainage prevents ice buildup'], estimatedSavings: '10-20% on heating costs' },
  ],
};

/**
 * Pool-specific seasonal data.
 */
const POOL_SEASONAL_DATA: TradeSeasonalData = {
  seasonalTimings: [
    {
      season: 'spring',
      months: ['March', 'April', 'May'],
      services: [
        { name: 'Pool Opening', priority: 'essential', reason: 'Prepare pool for swimming season', idealTiming: 'When temps consistently above 60°F' },
        { name: 'Equipment Inspection', priority: 'essential', reason: 'Check pump, filter, heater operation', idealTiming: 'During opening' },
        { name: 'Water Chemistry Balance', priority: 'essential', reason: 'Establish proper chemistry for season', idealTiming: 'After opening' },
      ],
      weatherConsiderations: ['Wait for consistent warm weather', 'Earlier in warmer climates'],
    },
    {
      season: 'summer',
      months: ['June', 'July', 'August'],
      services: [
        { name: 'Regular Maintenance', priority: 'essential', reason: 'Weekly cleaning and chemical balance', idealTiming: 'Weekly schedule' },
        { name: 'Equipment Repair', priority: 'essential', reason: 'Peak usage requires working equipment', idealTiming: 'As needed' },
        { name: 'Algae Prevention', priority: 'essential', reason: 'Heat promotes algae growth', idealTiming: 'Continuous monitoring' },
      ],
      weatherConsiderations: ['High heat requires more chemical attention', 'Heavy use increases maintenance needs'],
    },
    {
      season: 'fall',
      months: ['September', 'October', 'November'],
      services: [
        { name: 'Pool Closing', priority: 'essential', reason: 'Winterize before freezing temps', idealTiming: 'Before first freeze' },
        { name: 'Equipment Winterization', priority: 'essential', reason: 'Protect equipment from freeze damage', idealTiming: 'During closing' },
        { name: 'Cover Installation', priority: 'essential', reason: 'Protect pool during off-season', idealTiming: 'After closing' },
      ],
      weatherConsiderations: ['Must complete before freeze', 'Earlier in colder climates'],
    },
    {
      season: 'winter',
      months: ['December', 'January', 'February'],
      services: [
        { name: 'Cover Monitoring', priority: 'recommended', reason: 'Check cover condition and water level', idealTiming: 'Monthly checks' },
        { name: 'Pump Run (if applicable)', priority: 'recommended', reason: 'Prevent freeze damage if not fully winterized', idealTiming: 'During freezing temps' },
        { name: 'Spring Planning', priority: 'optional', reason: 'Plan upgrades and repairs for opening', idealTiming: 'Late winter' },
      ],
      weatherConsiderations: ['Pool closed in most climates', 'Monitor for cover damage from snow/ice'],
    },
  ],
  maintenanceSchedule: [
    { frequency: 'monthly', tasks: ['Test and balance water chemistry', 'Clean skimmer and pump baskets', 'Vacuum and brush pool surfaces', 'Check equipment operation'], bestMonths: ['May through September'] },
    { frequency: 'quarterly', tasks: ['Deep clean filter', 'Inspect all seals and gaskets', 'Check safety equipment'], bestMonths: ['During swimming season'] },
    { frequency: 'annual', tasks: ['Professional equipment inspection', 'Pool surface assessment', 'Opening and closing services'], bestMonths: ['Spring and Fall'] },
  ],
  energyEfficiencyTips: [
    { season: 'Summer', tips: ['Use pool cover when not in use to reduce evaporation', 'Run pump during off-peak hours', 'Consider variable-speed pump for efficiency', 'Maintain proper chemical balance to reduce equipment strain'], estimatedSavings: '30-50% on pool operating costs' },
    { season: 'Winter', tips: ['Properly winterized pool prevents damage and spring repairs', 'Quality cover protects water chemistry', 'Turn off equipment not needed for winter'], estimatedSavings: 'Prevents costly spring repairs' },
  ],
};

/**
 * Generates seasonal climate information for service businesses.
 *
 * @param input - BusinessInput with location and service information
 * @returns SeasonalClimateOutput with seasonal details
 */
export function generateSeasonalClimate(
  input: BusinessInput
): SeasonalClimateOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { location, services } = input;

  // Build location string
  const locationString = buildLocationString(location);

  // Determine climate zone
  const climateZone = determineClimateZone(location);

  // Get trade-specific seasonal data
  const tradeType = determineTradeType(services.primary);
  const tradeData = getTradeSeasonalData(tradeType);

  // Generate weather alerts based on climate zone
  const weatherAlerts = generateWeatherAlerts(climateZone);

  return {
    location: locationString,
    generatedAt: new Date().toISOString(),
    climateZone,
    seasonalTimings: tradeData.seasonalTimings,
    maintenanceSchedule: tradeData.maintenanceSchedule,
    weatherAlerts,
    energyEfficiencyTips: tradeData.energyEfficiencyTips,
    disclaimer: buildDisclaimer(locationString),
    sources: ['BusinessInput', 'GeneralClimateData'],
  };
}

/**
 * Builds location string from location data.
 */
function buildLocationString(location: BusinessInput['location']): string {
  const parts: string[] = [];

  if (hasValue(location.primaryCity)) {
    parts.push(location.primaryCity);
  }

  if (hasValue(location.region)) {
    parts.push(location.region);
  }

  return parts.join(', ') || 'Local Area';
}

/**
 * Determines climate zone based on location.
 * In production, this would use geocoding and climate data.
 */
function determineClimateZone(location: BusinessInput['location']): ClimateZoneInfo {
  const region = (location.region || '').toLowerCase();
  const city = (location.primaryCity || '').toLowerCase();

  // Very basic heuristic - would use proper climate data in production
  const hotHumidStates = ['florida', 'louisiana', 'mississippi', 'alabama', 'georgia', 'south carolina'];
  const hotDryStates = ['arizona', 'nevada', 'new mexico'];
  const coldStates = ['minnesota', 'wisconsin', 'michigan', 'maine', 'vermont', 'new hampshire', 'north dakota', 'montana', 'alaska'];
  const marineStates = ['washington', 'oregon'];

  if (hotHumidStates.some(s => region.includes(s))) {
    return CLIMATE_ZONES.hotHumid;
  }
  if (hotDryStates.some(s => region.includes(s))) {
    return CLIMATE_ZONES.hotDry;
  }
  if (coldStates.some(s => region.includes(s))) {
    return CLIMATE_ZONES.cold;
  }
  if (marineStates.some(s => region.includes(s))) {
    return CLIMATE_ZONES.marine;
  }

  return CLIMATE_ZONES.mixedHumid; // Default for most US locations
}

/**
 * Determines trade type from services.
 */
function determineTradeType(
  primaryServices: string[]
): 'hvac' | 'roofing' | 'landscaping' | 'pools' {
  if (!hasItems(primaryServices)) {
    return 'hvac'; // Default
  }

  const servicesLower = primaryServices.map(s => s.toLowerCase()).join(' ');

  if (servicesLower.includes('pool') || servicesLower.includes('spa') || servicesLower.includes('swimming')) {
    return 'pools';
  }
  if (servicesLower.includes('landscape') || servicesLower.includes('lawn') || servicesLower.includes('garden')) {
    return 'landscaping';
  }
  if (servicesLower.includes('roof') || servicesLower.includes('shingle') || servicesLower.includes('gutter')) {
    return 'roofing';
  }

  return 'hvac'; // Default
}

/**
 * Gets trade-specific seasonal data.
 */
function getTradeSeasonalData(
  tradeType: 'hvac' | 'roofing' | 'landscaping' | 'pools'
): TradeSeasonalData {
  switch (tradeType) {
    case 'pools':
      return POOL_SEASONAL_DATA;
    case 'landscaping':
      return LANDSCAPING_SEASONAL_DATA;
    case 'roofing':
      return ROOFING_SEASONAL_DATA;
    default:
      return HVAC_SEASONAL_DATA;
  }
}

/**
 * Generates weather alerts based on climate zone.
 */
function generateWeatherAlerts(
  climateZone: ClimateZoneInfo
): SeasonalClimateOutput['weatherAlerts'] {
  const alerts: SeasonalClimateOutput['weatherAlerts'] = [];

  // Add alerts based on climate zone challenges
  for (const challenge of climateZone.challenges.slice(0, 3)) {
    alerts.push({
      condition: challenge,
      impact: `Can affect system performance and longevity`,
      preventiveMeasures: climateZone.recommendations.slice(0, 2),
    });
  }

  return alerts;
}

/**
 * Builds disclaimer text.
 */
function buildDisclaimer(location: string): string {
  return `Seasonal and climate information for ${location} is provided for general guidance only. Actual weather patterns and service timing may vary based on specific local conditions and year-to-year variations. For specific scheduling recommendations, consult with local service professionals who understand your area's unique climate patterns. This information does not replace professional assessment of your specific needs.`;
}
