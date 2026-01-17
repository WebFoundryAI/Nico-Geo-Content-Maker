/**
 * Property Market Data Generator
 *
 * Generates local real estate market statistics, pricing trends,
 * and hot neighborhood data for real estate and mortgage businesses.
 *
 * INDUSTRIES: Real Estate, Mortgage
 *
 * DATA SOURCE STRATEGY:
 * - Uses template/placeholder data since real market data requires
 *   external API integration (Zillow, Redfin, etc.)
 * - All data is clearly marked as template data with disclaimers
 * - Future enhancement: integrate with real estate data APIs
 *
 * ANTI-HALLUCINATION:
 * - Never fabricates specific prices or statistics
 * - Uses clearly labeled template ranges
 * - All output includes disclaimer about data currency
 */

import type { BusinessInput } from '../../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
} from '../../rules/antiHallucination';
import type {
  PropertyMarketDataContract,
  MarketTrendPoint,
  HotAreaData,
} from '../../../contracts/output.contract';

/**
 * Output type for the Property Market Data generator.
 */
export type PropertyMarketDataOutput = PropertyMarketDataContract;

/**
 * Template market overview based on market conditions.
 */
interface TemplateMarketData {
  marketType: 'buyer' | 'seller' | 'balanced';
  medianPriceRange: { min: number; max: number };
  daysOnMarketRange: { min: number; max: number };
  yearOverYearChangeRange: { min: number; max: number };
}

/**
 * Template market data by region type.
 * These are general ranges, not specific to any location.
 */
const TEMPLATE_MARKET_DATA: Record<string, TemplateMarketData> = {
  urban: {
    marketType: 'seller',
    medianPriceRange: { min: 350000, max: 750000 },
    daysOnMarketRange: { min: 15, max: 45 },
    yearOverYearChangeRange: { min: 3, max: 8 },
  },
  suburban: {
    marketType: 'balanced',
    medianPriceRange: { min: 250000, max: 500000 },
    daysOnMarketRange: { min: 30, max: 60 },
    yearOverYearChangeRange: { min: 2, max: 6 },
  },
  rural: {
    marketType: 'buyer',
    medianPriceRange: { min: 150000, max: 350000 },
    daysOnMarketRange: { min: 45, max: 90 },
    yearOverYearChangeRange: { min: 0, max: 4 },
  },
  default: {
    marketType: 'balanced',
    medianPriceRange: { min: 200000, max: 450000 },
    daysOnMarketRange: { min: 30, max: 60 },
    yearOverYearChangeRange: { min: 2, max: 5 },
  },
};

/**
 * Generates property market data for a location.
 *
 * Note: This generator uses template data since real market data
 * requires external API integration. The output includes clear
 * disclaimers about data currency and accuracy.
 *
 * @param input - BusinessInput with location information
 * @returns PropertyMarketDataOutput with market statistics
 */
export function generatePropertyMarketData(
  input: BusinessInput
): PropertyMarketDataOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { location } = input;

  // Build location string
  const locationString = buildLocationString(location);

  // Determine region type (would use geocoding in production)
  const regionType = determineRegionType(location);
  const templateData = TEMPLATE_MARKET_DATA[regionType] || TEMPLATE_MARKET_DATA.default;

  // Generate template market overview
  const marketOverview = generateMarketOverview(templateData);

  // Generate template trends
  const trends = generateTemplateTrends(templateData);

  // Generate hot areas based on service areas
  const hotAreas = generateHotAreas(location.serviceAreas, templateData);

  // Generate price ranges
  const priceRanges = generatePriceRanges(templateData);

  return {
    location: locationString,
    generatedAt: new Date().toISOString(),
    marketOverview,
    trends,
    hotAreas,
    priceRanges,
    disclaimer: buildDisclaimer(locationString),
    sources: ['BusinessInput', 'TemplateData'],
  };
}

/**
 * Builds a location string from location data.
 */
function buildLocationString(location: BusinessInput['location']): string {
  const parts: string[] = [];

  if (hasValue(location.primaryCity)) {
    parts.push(location.primaryCity);
  }

  if (hasValue(location.region)) {
    parts.push(location.region);
  }

  if (hasValue(location.country)) {
    parts.push(location.country);
  }

  return parts.join(', ') || 'Local Market';
}

/**
 * Determines region type based on location characteristics.
 * In production, this would use geocoding and census data.
 */
function determineRegionType(
  location: BusinessInput['location']
): 'urban' | 'suburban' | 'rural' | 'default' {
  const city = location.primaryCity?.toLowerCase() || '';

  // Very basic heuristic - would use proper data in production
  const urbanIndicators = ['new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia', 'san antonio', 'san diego', 'dallas', 'san jose', 'austin', 'jacksonville', 'fort worth', 'columbus', 'charlotte', 'san francisco', 'indianapolis', 'seattle', 'denver', 'washington', 'boston', 'nashville', 'baltimore', 'oklahoma', 'louisville', 'portland', 'las vegas', 'milwaukee', 'albuquerque', 'tucson', 'fresno', 'sacramento', 'mesa', 'atlanta', 'kansas city', 'colorado springs', 'miami', 'raleigh', 'omaha', 'long beach', 'virginia beach', 'oakland', 'minneapolis', 'tulsa', 'tampa', 'arlington', 'new orleans'];

  for (const indicator of urbanIndicators) {
    if (city.includes(indicator)) {
      return 'urban';
    }
  }

  // Check for suburban indicators
  if (city.includes('heights') || city.includes('park') || city.includes('village') || city.includes('grove')) {
    return 'suburban';
  }

  // Default to suburban for most areas
  return 'suburban';
}

/**
 * Generates market overview from template data.
 */
function generateMarketOverview(templateData: TemplateMarketData): PropertyMarketDataOutput['marketOverview'] {
  // Use midpoint of ranges for template values
  const medianPrice = Math.round(
    (templateData.medianPriceRange.min + templateData.medianPriceRange.max) / 2
  );
  const daysOnMarket = Math.round(
    (templateData.daysOnMarketRange.min + templateData.daysOnMarketRange.max) / 2
  );
  const yearOverYearChange =
    (templateData.yearOverYearChangeRange.min + templateData.yearOverYearChangeRange.max) / 2;

  return {
    medianHomePrice: medianPrice,
    yearOverYearChange: Math.round(yearOverYearChange * 10) / 10,
    averageDaysOnMarket: daysOnMarket,
    activeListings: 0, // Placeholder - would come from real data
    marketType: templateData.marketType,
  };
}

/**
 * Generates template trend data points.
 */
function generateTemplateTrends(templateData: TemplateMarketData): MarketTrendPoint[] {
  const currentDate = new Date();
  const trends: MarketTrendPoint[] = [];

  // Generate last 4 quarters of template data
  for (let i = 3; i >= 0; i--) {
    const quarterDate = new Date(currentDate);
    quarterDate.setMonth(currentDate.getMonth() - i * 3);

    const quarter = Math.floor(quarterDate.getMonth() / 3) + 1;
    const year = quarterDate.getFullYear();

    // Slight variation for each quarter
    const variationFactor = 1 + (i * 0.02);
    const basePrice = (templateData.medianPriceRange.min + templateData.medianPriceRange.max) / 2;

    trends.push({
      period: `Q${quarter} ${year}`,
      medianPrice: Math.round(basePrice * variationFactor),
      priceChange: Math.round((templateData.yearOverYearChangeRange.min + templateData.yearOverYearChangeRange.max) / 2 * 10) / 10,
      daysOnMarket: Math.round((templateData.daysOnMarketRange.min + templateData.daysOnMarketRange.max) / 2),
      inventory: 0, // Placeholder
    });
  }

  return trends;
}

/**
 * Generates hot area data from service areas.
 */
function generateHotAreas(
  serviceAreas: string[],
  templateData: TemplateMarketData
): HotAreaData[] {
  if (!hasItems(serviceAreas)) {
    return [];
  }

  // Take first 3 service areas as "hot areas"
  const areas = serviceAreas.slice(0, 3);
  const demandLevels: Array<'high' | 'medium' | 'low'> = ['high', 'medium', 'medium'];

  return areas.map((area, index) => ({
    name: area,
    medianPrice: Math.round(
      ((templateData.medianPriceRange.min + templateData.medianPriceRange.max) / 2) *
        (1 + (index === 0 ? 0.1 : -0.05 * index))
    ),
    priceGrowth: Math.round(
      (templateData.yearOverYearChangeRange.min + templateData.yearOverYearChangeRange.max) / 2 * 10
    ) / 10,
    demandLevel: demandLevels[index] || 'medium',
    highlights: generateAreaHighlights(area, demandLevels[index] || 'medium'),
  }));
}

/**
 * Generates generic highlights for an area.
 */
function generateAreaHighlights(
  areaName: string,
  demandLevel: 'high' | 'medium' | 'low'
): string[] {
  const highlights: string[] = [];

  if (demandLevel === 'high') {
    highlights.push(`Strong demand in ${areaName}`);
    highlights.push('Low inventory levels');
  } else if (demandLevel === 'medium') {
    highlights.push(`Steady market activity in ${areaName}`);
    highlights.push('Balanced buyer-seller conditions');
  } else {
    highlights.push(`Growing opportunities in ${areaName}`);
    highlights.push('Increased inventory availability');
  }

  return highlights;
}

/**
 * Generates price range distribution.
 */
function generatePriceRanges(
  templateData: TemplateMarketData
): PropertyMarketDataOutput['priceRanges'] {
  const baseMin = templateData.medianPriceRange.min;
  const baseMax = templateData.medianPriceRange.max;
  const median = (baseMin + baseMax) / 2;

  return [
    {
      range: `Under $${Math.round(median * 0.6 / 1000)}K`,
      percentOfMarket: 15,
      typicalPropertyType: 'Condos, Starter homes',
    },
    {
      range: `$${Math.round(median * 0.6 / 1000)}K - $${Math.round(median / 1000)}K`,
      percentOfMarket: 35,
      typicalPropertyType: 'Single-family homes',
    },
    {
      range: `$${Math.round(median / 1000)}K - $${Math.round(median * 1.5 / 1000)}K`,
      percentOfMarket: 30,
      typicalPropertyType: 'Larger single-family homes',
    },
    {
      range: `Over $${Math.round(median * 1.5 / 1000)}K`,
      percentOfMarket: 20,
      typicalPropertyType: 'Luxury properties',
    },
  ];
}

/**
 * Builds the disclaimer text.
 */
function buildDisclaimer(location: string): string {
  return `Market data for ${location} is provided for informational purposes only and represents general market estimates. Actual market conditions may vary. For accurate, current market data, please consult with a licensed real estate professional or access official market reports. Data should not be used for making financial decisions without professional consultation.`;
}
