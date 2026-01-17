/**
 * First-Time Buyer Programs Generator
 *
 * Generates information about federal, state, and local first-time
 * homebuyer assistance programs for mortgage and real estate businesses.
 *
 * INDUSTRIES: Mortgage, Real Estate
 *
 * DATA SOURCE STRATEGY:
 * - Uses template data for common federal programs (FHA, VA, USDA, etc.)
 * - Provides general state/local program structure
 * - Future enhancement: integrate with HUD and state housing finance APIs
 *
 * ANTI-HALLUCINATION:
 * - Never fabricates specific program rates or limits
 * - Uses clearly labeled template/general information
 * - All output includes disclaimer about program availability
 */

import type { BusinessInput } from '../../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
} from '../../rules/antiHallucination';
import type {
  FirstTimeBuyerProgramsContract,
  BuyerProgram,
} from '../../../contracts/output.contract';

/**
 * Output type for the First-Time Buyer Programs generator.
 */
export type FirstTimeBuyerProgramsOutput = FirstTimeBuyerProgramsContract;

/**
 * Template federal programs (commonly available nationwide).
 */
const FEDERAL_PROGRAMS: BuyerProgram[] = [
  {
    name: 'FHA Loan Program',
    level: 'federal',
    type: 'loan',
    eligibility: [
      'Minimum credit score of 580 for 3.5% down payment',
      'Minimum credit score of 500 for 10% down payment',
      'Property must be primary residence',
      'Debt-to-income ratio requirements apply',
    ],
    benefits: [
      'Low down payment (as low as 3.5%)',
      'More flexible credit requirements',
      'Lower closing costs allowed',
      'Assumable by qualified buyers',
    ],
    requirements: [
      'Mortgage insurance premium (MIP) required',
      'Property must meet FHA standards',
      'Income documentation required',
    ],
    applicationProcess: 'Apply through FHA-approved lenders',
    contactInfo: 'HUD.gov or local FHA-approved lender',
  },
  {
    name: 'VA Home Loan',
    level: 'federal',
    type: 'loan',
    eligibility: [
      'Active duty service members',
      'Veterans with qualifying service',
      'National Guard and Reserve members',
      'Surviving spouses of veterans',
    ],
    benefits: [
      'No down payment required',
      'No private mortgage insurance (PMI)',
      'Competitive interest rates',
      'Limited closing costs',
    ],
    requirements: [
      'Certificate of Eligibility (COE)',
      'Property must be primary residence',
      'VA funding fee (may be waived for some)',
    ],
    applicationProcess: 'Apply through VA-approved lenders',
    contactInfo: 'VA.gov or local VA Regional Loan Center',
  },
  {
    name: 'USDA Rural Development Loan',
    level: 'federal',
    type: 'loan',
    eligibility: [
      'Property in eligible rural area',
      'Income below 115% of area median income',
      'U.S. citizen or permanent resident',
      'Meet credit requirements',
    ],
    benefits: [
      'No down payment required',
      'Low mortgage insurance costs',
      'Below-market interest rates possible',
      'Closing costs can be financed',
    ],
    requirements: [
      'Property in USDA-eligible area',
      'Income limits apply',
      'Property must be primary residence',
    ],
    applicationProcess: 'Apply through USDA-approved lenders',
    contactInfo: 'USDA.gov or local USDA office',
  },
  {
    name: 'Conventional 97 Loan',
    level: 'federal',
    type: 'loan',
    eligibility: [
      'First-time homebuyers',
      'Minimum credit score typically 620-660',
      'Income limits may apply in some areas',
      'Homebuyer education may be required',
    ],
    benefits: [
      'Low 3% down payment',
      'PMI can be cancelled at 80% LTV',
      'Competitive interest rates',
      'Backed by Fannie Mae/Freddie Mac',
    ],
    requirements: [
      'Private mortgage insurance required',
      'Property must be primary residence',
      'Debt-to-income limits apply',
    ],
    applicationProcess: 'Apply through approved lenders',
    contactInfo: 'Local mortgage lenders',
  },
  {
    name: 'HomeReady Mortgage (Fannie Mae)',
    level: 'federal',
    type: 'loan',
    eligibility: [
      'Low-to-moderate income borrowers',
      'Income at or below 80% AMI',
      'Minimum 620 credit score',
      'Homebuyer education required',
    ],
    benefits: [
      '3% down payment',
      'Reduced mortgage insurance',
      'Non-occupant co-borrowers allowed',
      'Rental income can qualify',
    ],
    requirements: [
      'Income documentation',
      'Complete homebuyer education',
      'PMI required (reduced rates)',
    ],
    applicationProcess: 'Apply through Fannie Mae-approved lenders',
    contactInfo: 'FannieMae.com or local lenders',
  },
  {
    name: 'Home Possible Mortgage (Freddie Mac)',
    level: 'federal',
    type: 'loan',
    eligibility: [
      'Low-to-moderate income borrowers',
      'Income at or below 80% AMI',
      'First-time or repeat buyers',
      'Minimum 660 credit score (flexible)',
    ],
    benefits: [
      '3% down payment',
      'Reduced mortgage insurance costs',
      'Flexible funding sources for down payment',
      'Non-occupant co-borrowers allowed',
    ],
    requirements: [
      'Homebuyer education recommended',
      'Income limits based on location',
      'Property must be primary residence',
    ],
    applicationProcess: 'Apply through Freddie Mac-approved lenders',
    contactInfo: 'FreddieMac.com or local lenders',
  },
];

/**
 * Template state program structure.
 */
interface StateProgram {
  name: string;
  type: 'grant' | 'loan' | 'tax-credit' | 'assistance';
  description: string;
  commonEligibility: string[];
  typicalBenefits: string[];
}

/**
 * Common state-level program types.
 */
const STATE_PROGRAM_TEMPLATES: StateProgram[] = [
  {
    name: 'State Housing Finance Agency First-Time Buyer Program',
    type: 'loan',
    description: 'Below-market rate mortgages for first-time homebuyers',
    commonEligibility: ['First-time buyer status', 'Income limits', 'Purchase price limits', 'Homebuyer education'],
    typicalBenefits: ['Competitive interest rates', 'Down payment assistance options', 'Combined with federal programs'],
  },
  {
    name: 'Down Payment Assistance Program',
    type: 'assistance',
    description: 'Funds to help cover down payment and closing costs',
    commonEligibility: ['Income limits', 'First-time buyer or target areas', 'Complete homebuyer education', 'Minimum investment required'],
    typicalBenefits: ['Grant or forgivable loan', 'Covers 3-5% of purchase price', 'Can combine with other programs'],
  },
  {
    name: 'Mortgage Credit Certificate (MCC)',
    type: 'tax-credit',
    description: 'Federal tax credit for portion of mortgage interest paid',
    commonEligibility: ['First-time buyer', 'Income limits', 'Purchase price limits', 'Primary residence'],
    typicalBenefits: ['Annual tax credit up to 20-25% of interest', 'Reduces tax liability', 'Increases buying power'],
  },
];

/**
 * Common tax credits for homebuyers.
 */
const TAX_CREDITS_TEMPLATE: FirstTimeBuyerProgramsOutput['taxCredits'] = [
  {
    name: 'Mortgage Interest Deduction',
    description: 'Deduct mortgage interest on primary residence from federal taxes',
    maxBenefit: 'Interest on up to $750,000 mortgage debt',
    eligibility: ['Must itemize deductions', 'Primary residence', 'Secured debt on qualified home'],
  },
  {
    name: 'Property Tax Deduction',
    description: 'Deduct state and local property taxes from federal taxes',
    maxBenefit: 'Part of $10,000 SALT deduction limit',
    eligibility: ['Must itemize deductions', 'Pay property taxes on owned property'],
  },
  {
    name: 'Mortgage Credit Certificate (MCC)',
    description: 'Direct tax credit for portion of mortgage interest paid',
    maxBenefit: 'Typically 20-25% of annual mortgage interest',
    eligibility: ['First-time homebuyer', 'Income limits apply', 'Must obtain before closing'],
  },
];

/**
 * Generates first-time buyer programs information.
 *
 * @param input - BusinessInput with location information
 * @returns FirstTimeBuyerProgramsOutput with program details
 */
export function generateFirstTimeBuyerPrograms(
  input: BusinessInput
): FirstTimeBuyerProgramsOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { location } = input;

  // Build location string
  const locationString = buildLocationString(location);

  // Generate state programs based on location
  const statePrograms = generateStatePrograms(location);

  // Generate local programs based on location
  const localPrograms = generateLocalPrograms(location);

  // Generate income guidelines placeholder
  const incomeGuidelines = generateIncomeGuidelines();

  return {
    location: locationString,
    generatedAt: new Date().toISOString(),
    federalPrograms: FEDERAL_PROGRAMS,
    statePrograms,
    localPrograms,
    taxCredits: TAX_CREDITS_TEMPLATE,
    incomeGuidelines,
    disclaimer: buildDisclaimer(locationString),
    sources: ['BusinessInput', 'FederalProgramReferences'],
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

  return parts.join(', ') || 'Local Area';
}

/**
 * Generates state-level programs.
 */
function generateStatePrograms(location: BusinessInput['location']): BuyerProgram[] {
  const stateName = location.region || 'State';

  return STATE_PROGRAM_TEMPLATES.map(template => ({
    name: `${stateName} ${template.name}`,
    level: 'state' as const,
    type: template.type,
    eligibility: template.commonEligibility,
    benefits: template.typicalBenefits,
    requirements: [
      'Application through state housing finance agency',
      'Income and purchase price documentation',
      'Homebuyer education certificate',
    ],
    applicationProcess: `Contact ${stateName} Housing Finance Agency`,
    contactInfo: `${stateName} Housing Finance Agency website`,
  }));
}

/**
 * Generates local programs.
 */
function generateLocalPrograms(location: BusinessInput['location']): BuyerProgram[] {
  const cityName = location.primaryCity || 'Local';
  const programs: BuyerProgram[] = [];

  // City down payment assistance
  programs.push({
    name: `${cityName} Down Payment Assistance Program`,
    level: 'local',
    type: 'assistance',
    eligibility: [
      'First-time homebuyer',
      'Purchase property within city limits',
      'Meet income requirements',
      'Complete homebuyer education',
    ],
    benefits: [
      'Assistance with down payment',
      'May cover closing costs',
      'Often forgivable after residency period',
    ],
    requirements: [
      'Residency requirement may apply',
      'Property standards must be met',
      'Must use approved lender',
    ],
    applicationProcess: `Contact ${cityName} Housing Department or Community Development`,
    contactInfo: `${cityName} City Hall or Housing Authority`,
  });

  // Community land trust option
  programs.push({
    name: `${cityName} Area Community Land Trust`,
    level: 'local',
    type: 'assistance',
    eligibility: [
      'Income limits typically apply',
      'Willingness to participate in land trust model',
      'First-time buyers may be prioritized',
    ],
    benefits: [
      'Below-market home prices',
      'Permanently affordable housing',
      'Shared equity builds wealth',
    ],
    requirements: [
      'Ground lease with land trust',
      'Restrictions on resale price',
      'Must maintain as primary residence',
    ],
    applicationProcess: 'Contact local Community Land Trust organization',
  });

  return programs;
}

/**
 * Generates income guidelines placeholder.
 */
function generateIncomeGuidelines(): FirstTimeBuyerProgramsOutput['incomeGuidelines'] {
  // These are placeholder values - actual AMI varies significantly by location
  return {
    areaMedianIncome: 0, // Would be populated from HUD data
    incomeLimit80Percent: 0, // Low-income limit
    incomeLimit120Percent: 0, // Moderate-income limit
  };
}

/**
 * Builds disclaimer text.
 */
function buildDisclaimer(location: string): string {
  return `First-time homebuyer programs for ${location} are provided for informational purposes only. Program availability, eligibility requirements, and benefits are subject to change and may vary based on funding availability. Income and purchase price limits are updated annually. For current program information and eligibility, please contact the specific program administrator or consult with a licensed mortgage professional. This information does not constitute financial advice.`;
}
