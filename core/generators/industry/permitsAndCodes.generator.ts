/**
 * Permits & Building Codes Generator
 *
 * Generates jurisdiction-specific permit requirements, building codes,
 * and inspection information for contractor businesses.
 *
 * INDUSTRIES: Plumbing, HVAC, Electrical, Roofing, General Contractor
 *
 * DATA SOURCE STRATEGY:
 * - Uses template data for common permit types and code references
 * - Provides general guidance without jurisdiction-specific details
 * - Future enhancement: integrate with municipal permit databases
 *
 * ANTI-HALLUCINATION:
 * - Never fabricates specific permit fees or timelines
 * - Uses clearly labeled template/general information
 * - All output includes disclaimer about verifying with local authorities
 */

import type { BusinessInput } from '../../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
} from '../../rules/antiHallucination';
import type {
  PermitsAndCodesContract,
  PermitRequirement,
  BuildingCodeInfo,
} from '../../../contracts/output.contract';

/**
 * Output type for the Permits & Codes generator.
 */
export type PermitsAndCodesOutput = PermitsAndCodesContract;

/**
 * Trade-specific permit templates.
 */
interface TradePermitTemplate {
  commonPermits: PermitRequirement[];
  relevantCodes: BuildingCodeInfo[];
  inspectionStages: Array<{
    stage: string;
    description: string;
    typicalDuration: string;
  }>;
  licensingInfo: Array<{
    licenseType: string;
    requirements: string[];
    renewalPeriod: string;
  }>;
}

/**
 * Template permit data by trade type.
 */
const TRADE_PERMIT_TEMPLATES: Record<string, TradePermitTemplate> = {
  plumbing: {
    commonPermits: [
      {
        permitType: 'Plumbing Permit',
        description: 'Required for installation, alteration, or repair of plumbing systems',
        requiredFor: ['New plumbing installations', 'Water heater replacement', 'Sewer line work', 'Re-piping projects'],
        estimatedCost: 'Varies by jurisdiction (typically $50-$500)',
        processingTime: 'Typically 1-5 business days',
        issuingAuthority: 'Local Building Department',
      },
      {
        permitType: 'Water Heater Permit',
        description: 'Specific permit for water heater installation or replacement',
        requiredFor: ['Tank water heater installation', 'Tankless water heater installation', 'Commercial water heater systems'],
        estimatedCost: 'Varies by jurisdiction (typically $25-$150)',
        processingTime: 'Often same-day to 3 business days',
        issuingAuthority: 'Local Building Department',
      },
    ],
    relevantCodes: [
      {
        codeType: 'International Plumbing Code (IPC)',
        version: 'Check local adoption',
        keyRequirements: ['Proper venting of drainage systems', 'Water supply sizing requirements', 'Backflow prevention', 'Fixture unit calculations'],
        commonViolations: ['Improper venting', 'Missing cleanouts', 'Incorrect pipe sizing', 'Lack of proper supports'],
        resources: ['Local building department', 'State plumbing board'],
      },
      {
        codeType: 'Uniform Plumbing Code (UPC)',
        version: 'Check local adoption',
        keyRequirements: ['Drainage fixture unit loads', 'Vent sizing and termination', 'Water distribution system design', 'Hot water system requirements'],
        commonViolations: ['S-trap installations', 'Improper water heater venting', 'Missing expansion tanks', 'Incorrect slope on drain lines'],
        resources: ['IAPMO (International Association of Plumbing and Mechanical Officials)'],
      },
    ],
    inspectionStages: [
      { stage: 'Rough-in inspection', description: 'Inspection of plumbing before walls are closed', typicalDuration: '30-60 minutes' },
      { stage: 'Final inspection', description: 'Complete system inspection after all fixtures installed', typicalDuration: '30-60 minutes' },
      { stage: 'Sewer/septic inspection', description: 'Inspection of sewer line connections or septic systems', typicalDuration: '30-45 minutes' },
    ],
    licensingInfo: [
      {
        licenseType: 'Journeyman Plumber License',
        requirements: ['Completion of apprenticeship program', 'Passing state/local examination', 'Work experience requirements'],
        renewalPeriod: 'Typically 1-2 years',
      },
      {
        licenseType: 'Master Plumber License',
        requirements: ['Journeyman experience', 'Advanced examination', 'Business insurance requirements'],
        renewalPeriod: 'Typically 1-2 years',
      },
    ],
  },
  hvac: {
    commonPermits: [
      {
        permitType: 'Mechanical Permit',
        description: 'Required for HVAC system installation, replacement, or modification',
        requiredFor: ['New HVAC system installation', 'Furnace replacement', 'AC unit installation', 'Ductwork modifications'],
        estimatedCost: 'Varies by jurisdiction (typically $50-$500)',
        processingTime: 'Typically 1-5 business days',
        issuingAuthority: 'Local Building Department',
      },
      {
        permitType: 'Electrical Permit',
        description: 'Often required for HVAC electrical connections',
        requiredFor: ['New circuit installation for AC', 'Electrical panel upgrades', 'Thermostat wiring'],
        estimatedCost: 'Varies by jurisdiction (typically $25-$200)',
        processingTime: 'Typically 1-3 business days',
        issuingAuthority: 'Local Building Department',
      },
    ],
    relevantCodes: [
      {
        codeType: 'International Mechanical Code (IMC)',
        version: 'Check local adoption',
        keyRequirements: ['Equipment sizing calculations', 'Ductwork installation standards', 'Ventilation requirements', 'Refrigerant handling'],
        commonViolations: ['Undersized return air', 'Improper condensate drainage', 'Missing access panels', 'Inadequate clearances'],
        resources: ['Local building department', 'ACCA (Air Conditioning Contractors of America)'],
      },
      {
        codeType: 'International Energy Conservation Code (IECC)',
        version: 'Check local adoption',
        keyRequirements: ['Minimum efficiency ratings', 'Duct insulation requirements', 'Sealing requirements', 'Manual J/S/D calculations'],
        commonViolations: ['Installing equipment below minimum efficiency', 'Improper duct sealing', 'Missing insulation'],
        resources: ['DOE Building Energy Codes Program'],
      },
    ],
    inspectionStages: [
      { stage: 'Rough-in inspection', description: 'Inspection of ductwork and refrigerant lines before closing walls', typicalDuration: '30-60 minutes' },
      { stage: 'Final inspection', description: 'Complete system operation and safety inspection', typicalDuration: '45-90 minutes' },
    ],
    licensingInfo: [
      {
        licenseType: 'HVAC Technician License',
        requirements: ['Technical training or apprenticeship', 'EPA Section 608 Certification', 'State/local examination'],
        renewalPeriod: 'Typically 1-2 years',
      },
      {
        licenseType: 'HVAC Contractor License',
        requirements: ['Technician experience', 'Business insurance', 'Bond requirements', 'Contractor examination'],
        renewalPeriod: 'Typically 1-2 years',
      },
    ],
  },
  electrical: {
    commonPermits: [
      {
        permitType: 'Electrical Permit',
        description: 'Required for electrical installations, modifications, or repairs',
        requiredFor: ['New circuits', 'Panel upgrades', 'Outlet additions', 'Service upgrades', 'Generator installation'],
        estimatedCost: 'Varies by jurisdiction (typically $25-$500)',
        processingTime: 'Typically 1-5 business days',
        issuingAuthority: 'Local Building Department',
      },
    ],
    relevantCodes: [
      {
        codeType: 'National Electrical Code (NEC/NFPA 70)',
        version: 'Check local adoption year',
        keyRequirements: ['Wire sizing and overcurrent protection', 'Grounding and bonding', 'GFCI/AFCI protection requirements', 'Box fill calculations'],
        commonViolations: ['Overloaded circuits', 'Missing GFCI protection', 'Improper grounding', 'Wrong wire gauge for load'],
        resources: ['NFPA', 'Local electrical inspector'],
      },
    ],
    inspectionStages: [
      { stage: 'Rough-in inspection', description: 'Inspection of wiring before walls are closed', typicalDuration: '30-60 minutes' },
      { stage: 'Final inspection', description: 'Complete electrical system testing and verification', typicalDuration: '30-60 minutes' },
      { stage: 'Service/meter inspection', description: 'Utility connection inspection', typicalDuration: '15-30 minutes' },
    ],
    licensingInfo: [
      {
        licenseType: 'Journeyman Electrician License',
        requirements: ['Apprenticeship completion', 'State/local examination', 'Work hour requirements'],
        renewalPeriod: 'Typically 1-3 years',
      },
      {
        licenseType: 'Master Electrician License',
        requirements: ['Journeyman experience', 'Advanced examination', 'Continuing education'],
        renewalPeriod: 'Typically 1-3 years',
      },
    ],
  },
  roofing: {
    commonPermits: [
      {
        permitType: 'Roofing Permit',
        description: 'Required for roof replacement, repair, or modification',
        requiredFor: ['Complete roof replacement', 'Structural repairs', 'Adding skylights', 'Solar panel installation'],
        estimatedCost: 'Varies by jurisdiction (typically $50-$300)',
        processingTime: 'Typically 1-5 business days',
        issuingAuthority: 'Local Building Department',
      },
      {
        permitType: 'Building Permit',
        description: 'May be required for structural roof modifications',
        requiredFor: ['Roof structure changes', 'Load-bearing modifications', 'Additions'],
        estimatedCost: 'Varies based on project scope',
        processingTime: 'Typically 3-10 business days',
        issuingAuthority: 'Local Building Department',
      },
    ],
    relevantCodes: [
      {
        codeType: 'International Building Code (IBC)',
        version: 'Check local adoption',
        keyRequirements: ['Roof covering requirements', 'Wind uplift resistance', 'Fire rating requirements', 'Structural load requirements'],
        commonViolations: ['Exceeding layer limits', 'Improper flashing', 'Inadequate ventilation', 'Missing drip edge'],
        resources: ['Local building department', 'Roofing manufacturer guidelines'],
      },
      {
        codeType: 'International Residential Code (IRC)',
        version: 'Check local adoption',
        keyRequirements: ['Shingle installation requirements', 'Underlayment specifications', 'Flashing requirements', 'Ventilation calculations'],
        commonViolations: ['Improper nail placement', 'Wrong underlayment type', 'Missing ice and water shield'],
        resources: ['ICC (International Code Council)'],
      },
    ],
    inspectionStages: [
      { stage: 'Deck inspection', description: 'Inspection of roof decking before covering', typicalDuration: '20-30 minutes' },
      { stage: 'Final inspection', description: 'Complete roof installation verification', typicalDuration: '30-45 minutes' },
    ],
    licensingInfo: [
      {
        licenseType: 'Roofing Contractor License',
        requirements: ['Trade experience', 'Insurance requirements', 'Bond requirements', 'Contractor examination'],
        renewalPeriod: 'Typically 1-2 years',
      },
    ],
  },
  contractor: {
    commonPermits: [
      {
        permitType: 'Building Permit',
        description: 'Required for construction, renovation, or structural modifications',
        requiredFor: ['New construction', 'Additions', 'Structural modifications', 'Major renovations'],
        estimatedCost: 'Varies by project value (typically 1-2% of project cost)',
        processingTime: 'Varies by scope (typically 5-30 business days)',
        issuingAuthority: 'Local Building Department',
      },
      {
        permitType: 'Demolition Permit',
        description: 'Required for demolition of structures',
        requiredFor: ['Complete demolition', 'Partial demolition', 'Interior demolition'],
        estimatedCost: 'Varies by jurisdiction',
        processingTime: 'Typically 3-10 business days',
        issuingAuthority: 'Local Building Department',
      },
    ],
    relevantCodes: [
      {
        codeType: 'International Building Code (IBC)',
        version: 'Check local adoption',
        keyRequirements: ['Structural requirements', 'Fire safety', 'Accessibility (ADA)', 'Egress requirements'],
        commonViolations: ['Unpermitted work', 'Structural modifications without engineering', 'Egress issues', 'Fire separation violations'],
        resources: ['Local building department', 'State contractor licensing board'],
      },
      {
        codeType: 'International Residential Code (IRC)',
        version: 'Check local adoption',
        keyRequirements: ['Foundation requirements', 'Framing standards', 'Stair/railing specifications', 'Bedroom egress'],
        commonViolations: ['Improper header sizing', 'Missing fire blocking', 'Stair dimension violations'],
        resources: ['ICC (International Code Council)'],
      },
    ],
    inspectionStages: [
      { stage: 'Foundation inspection', description: 'Inspection before concrete pour', typicalDuration: '30-60 minutes' },
      { stage: 'Framing inspection', description: 'Inspection of structural framing', typicalDuration: '45-90 minutes' },
      { stage: 'Insulation inspection', description: 'Inspection of insulation before drywall', typicalDuration: '20-30 minutes' },
      { stage: 'Final inspection', description: 'Complete project verification', typicalDuration: '60-120 minutes' },
    ],
    licensingInfo: [
      {
        licenseType: 'General Contractor License',
        requirements: ['Trade experience', 'Business insurance', 'Bond requirements', 'Contractor examination'],
        renewalPeriod: 'Typically 1-2 years',
      },
    ],
  },
};

/**
 * Generates permits and codes information for contractor businesses.
 *
 * @param input - BusinessInput with location and service information
 * @returns PermitsAndCodesOutput with permit and code details
 */
export function generatePermitsAndCodes(
  input: BusinessInput
): PermitsAndCodesOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { location, services } = input;

  // Determine trade type from services
  const tradeType = determineTradeType(services.primary);
  const template = TRADE_PERMIT_TEMPLATES[tradeType] || TRADE_PERMIT_TEMPLATES.contractor;

  // Build jurisdiction string
  const jurisdiction = buildJurisdictionString(location);

  return {
    jurisdiction,
    generatedAt: new Date().toISOString(),
    permits: template.commonPermits.map(permit => ({
      ...permit,
      issuingAuthority: `${jurisdiction} ${permit.issuingAuthority}`,
    })),
    buildingCodes: template.relevantCodes,
    inspectionRequirements: template.inspectionStages,
    licensingRequirements: template.licensingInfo,
    disclaimer: buildDisclaimer(jurisdiction, tradeType),
    sources: ['BusinessInput', 'GeneralCodeReferences'],
  };
}

/**
 * Determines trade type from services.
 */
function determineTradeType(
  primaryServices: string[]
): 'plumbing' | 'hvac' | 'electrical' | 'roofing' | 'contractor' {
  if (!hasItems(primaryServices)) {
    return 'contractor';
  }

  const servicesLower = primaryServices.map(s => s.toLowerCase()).join(' ');

  if (servicesLower.includes('plumb') || servicesLower.includes('drain') || servicesLower.includes('water heater')) {
    return 'plumbing';
  }
  if (servicesLower.includes('hvac') || servicesLower.includes('heating') || servicesLower.includes('cooling') || servicesLower.includes('air condition')) {
    return 'hvac';
  }
  if (servicesLower.includes('electric') || servicesLower.includes('wiring')) {
    return 'electrical';
  }
  if (servicesLower.includes('roof') || servicesLower.includes('shingle') || servicesLower.includes('gutter')) {
    return 'roofing';
  }

  return 'contractor';
}

/**
 * Builds jurisdiction string from location.
 */
function buildJurisdictionString(location: BusinessInput['location']): string {
  const parts: string[] = [];

  if (hasValue(location.primaryCity)) {
    parts.push(location.primaryCity);
  }

  if (hasValue(location.region)) {
    parts.push(location.region);
  }

  return parts.join(', ') || 'Local Jurisdiction';
}

/**
 * Builds disclaimer text.
 */
function buildDisclaimer(jurisdiction: string, tradeType: string): string {
  return `Permit requirements and building codes for ${jurisdiction} are provided for general informational purposes only. Requirements vary by jurisdiction and are subject to change. Always verify current requirements with your local building department before starting any ${tradeType} project. This information does not constitute legal or professional advice. Specific fees, timelines, and requirements should be confirmed with local authorities.`;
}
