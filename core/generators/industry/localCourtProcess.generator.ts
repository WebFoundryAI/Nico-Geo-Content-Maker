/**
 * Local Court Process Generator
 *
 * Generates local court procedures, timelines, and filing requirements
 * for law firms and attorneys.
 *
 * INDUSTRIES: Lawyers, Attorneys
 *
 * DATA SOURCE STRATEGY:
 * - Uses template data for common legal procedures
 * - Provides general guidance without jurisdiction-specific details
 * - Future enhancement: integrate with court system APIs
 *
 * ANTI-HALLUCINATION:
 * - Never fabricates specific court rules or fees
 * - Uses clearly labeled template/general information
 * - All output includes disclaimer about consulting with attorneys
 */

import type { BusinessInput } from '../../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
} from '../../rules/antiHallucination';
import type {
  LocalCourtProcessContract,
  CourtProcedureStep,
  CourtFilingInfo,
} from '../../../contracts/output.contract';

/**
 * Output type for the Local Court Process generator.
 */
export type LocalCourtProcessOutput = LocalCourtProcessContract;

/**
 * Practice area template with procedures.
 */
interface PracticeAreaTemplate {
  area: string;
  procedures: CourtProcedureStep[];
  typicalDuration: string;
}

/**
 * Common practice area templates.
 */
const PRACTICE_AREA_TEMPLATES: Record<string, PracticeAreaTemplate> = {
  'personal-injury': {
    area: 'Personal Injury',
    typicalDuration: '12-24 months average',
    procedures: [
      {
        stepNumber: 1,
        name: 'Initial Consultation & Case Evaluation',
        description: 'Review of incident details, injuries, and potential liability',
        typicalTimeline: '1-2 weeks',
        requiredDocuments: ['Medical records', 'Incident report', 'Insurance information', 'Photos of injuries/damage'],
        fees: 'Often free consultation',
      },
      {
        stepNumber: 2,
        name: 'Investigation & Evidence Gathering',
        description: 'Thorough investigation of the incident and collection of evidence',
        typicalTimeline: '2-8 weeks',
        requiredDocuments: ['Witness statements', 'Expert reports', 'Additional medical documentation'],
      },
      {
        stepNumber: 3,
        name: 'Demand Letter & Negotiation',
        description: 'Formal demand sent to insurance company with settlement negotiations',
        typicalTimeline: '4-12 weeks',
        requiredDocuments: ['Demand package', 'Medical bills summary', 'Lost wage documentation'],
      },
      {
        stepNumber: 4,
        name: 'Filing Lawsuit (if needed)',
        description: 'Complaint filed with the court if settlement not reached',
        typicalTimeline: 'Before statute of limitations expires',
        requiredDocuments: ['Complaint', 'Summons', 'Civil cover sheet'],
        fees: 'Filing fees vary by court',
      },
      {
        stepNumber: 5,
        name: 'Discovery Phase',
        description: 'Exchange of information between parties through depositions, interrogatories',
        typicalTimeline: '6-12 months',
        requiredDocuments: ['Interrogatories', 'Requests for production', 'Deposition notices'],
      },
      {
        stepNumber: 6,
        name: 'Mediation/Settlement Conference',
        description: 'Attempt to resolve case through alternative dispute resolution',
        typicalTimeline: '1 day to several weeks',
        requiredDocuments: ['Mediation brief', 'Settlement demand'],
      },
      {
        stepNumber: 7,
        name: 'Trial (if needed)',
        description: 'Presentation of case before judge or jury',
        typicalTimeline: '3-10 days',
        requiredDocuments: ['Trial exhibits', 'Witness lists', 'Jury instructions'],
      },
    ],
  },
  'family-law': {
    area: 'Family Law / Divorce',
    typicalDuration: '3-18 months average',
    procedures: [
      {
        stepNumber: 1,
        name: 'Initial Consultation',
        description: 'Review of marriage, assets, children, and goals',
        typicalTimeline: '1-2 hours',
        requiredDocuments: ['Marriage certificate', 'Financial documents', 'Property records'],
        fees: 'Varies by attorney',
      },
      {
        stepNumber: 2,
        name: 'Filing Petition',
        description: 'Filing divorce/dissolution petition with the court',
        typicalTimeline: '1-2 weeks to prepare',
        requiredDocuments: ['Petition for Dissolution', 'Summons', 'Financial disclosure forms'],
        fees: 'Filing fees vary by county',
      },
      {
        stepNumber: 3,
        name: 'Service of Process',
        description: 'Formal delivery of divorce papers to spouse',
        typicalTimeline: '1-4 weeks',
        requiredDocuments: ['Proof of service'],
      },
      {
        stepNumber: 4,
        name: 'Response Period',
        description: 'Spouse has time to file response to petition',
        typicalTimeline: '20-30 days (varies by state)',
        requiredDocuments: ['Response to petition'],
      },
      {
        stepNumber: 5,
        name: 'Discovery & Financial Disclosure',
        description: 'Exchange of financial and property information',
        typicalTimeline: '1-3 months',
        requiredDocuments: ['Financial declarations', 'Tax returns', 'Bank statements'],
      },
      {
        stepNumber: 6,
        name: 'Negotiation/Mediation',
        description: 'Attempt to reach agreement on contested issues',
        typicalTimeline: '1-4 months',
        requiredDocuments: ['Settlement proposals', 'Parenting plan drafts'],
      },
      {
        stepNumber: 7,
        name: 'Trial or Settlement',
        description: 'Final hearing or entry of settlement agreement',
        typicalTimeline: '1 day to 2 weeks for trial',
        requiredDocuments: ['Judgment', 'Marital settlement agreement', 'Parenting plan'],
      },
    ],
  },
  'criminal-defense': {
    area: 'Criminal Defense',
    typicalDuration: '2-12 months average',
    procedures: [
      {
        stepNumber: 1,
        name: 'Arrest & Booking',
        description: 'Processing at law enforcement facility',
        typicalTimeline: 'Within 24-48 hours of arrest',
        requiredDocuments: ['Arrest report', 'Booking documents'],
      },
      {
        stepNumber: 2,
        name: 'Initial Appearance/Arraignment',
        description: 'First court appearance where charges are read and bail is set',
        typicalTimeline: 'Within 24-72 hours of arrest',
        requiredDocuments: ['Charging document', 'Bail motion'],
        fees: 'Bail/bond amount varies',
      },
      {
        stepNumber: 3,
        name: 'Preliminary Hearing (Felonies)',
        description: 'Hearing to determine if enough evidence exists for trial',
        typicalTimeline: '2-4 weeks after arraignment',
        requiredDocuments: ['Defense motions', 'Witness lists'],
      },
      {
        stepNumber: 4,
        name: 'Discovery',
        description: 'Exchange of evidence between prosecution and defense',
        typicalTimeline: '2-8 weeks',
        requiredDocuments: ['Discovery requests', 'Evidence review'],
      },
      {
        stepNumber: 5,
        name: 'Pre-Trial Motions',
        description: 'Filing motions to suppress evidence, dismiss charges, etc.',
        typicalTimeline: '2-6 weeks before trial',
        requiredDocuments: ['Motion briefs', 'Supporting case law'],
      },
      {
        stepNumber: 6,
        name: 'Plea Negotiations',
        description: 'Negotiation with prosecution for potential plea agreement',
        typicalTimeline: 'Ongoing throughout process',
        requiredDocuments: ['Plea agreement (if applicable)'],
      },
      {
        stepNumber: 7,
        name: 'Trial',
        description: 'Presentation of case before judge or jury',
        typicalTimeline: '2-10 days',
        requiredDocuments: ['Trial exhibits', 'Witness subpoenas', 'Jury instructions'],
      },
    ],
  },
  'estate-planning': {
    area: 'Estate Planning',
    typicalDuration: '2-6 weeks for basic planning',
    procedures: [
      {
        stepNumber: 1,
        name: 'Initial Consultation',
        description: 'Review of assets, family situation, and estate planning goals',
        typicalTimeline: '1-2 hours',
        requiredDocuments: ['Asset inventory', 'Family information', 'Existing estate documents'],
        fees: 'Varies by attorney',
      },
      {
        stepNumber: 2,
        name: 'Information Gathering',
        description: 'Collection of detailed asset and beneficiary information',
        typicalTimeline: '1-2 weeks',
        requiredDocuments: ['Account statements', 'Property deeds', 'Insurance policies'],
      },
      {
        stepNumber: 3,
        name: 'Document Drafting',
        description: 'Preparation of wills, trusts, and other documents',
        typicalTimeline: '1-3 weeks',
        requiredDocuments: ['Draft review'],
      },
      {
        stepNumber: 4,
        name: 'Review & Revision',
        description: 'Client review of drafted documents with revisions',
        typicalTimeline: '1-2 weeks',
        requiredDocuments: ['Marked drafts', 'Revision notes'],
      },
      {
        stepNumber: 5,
        name: 'Execution Ceremony',
        description: 'Formal signing of documents with witnesses and notary',
        typicalTimeline: '1 hour',
        requiredDocuments: ['Final documents', 'Witness identification'],
      },
    ],
  },
  general: {
    area: 'General Civil Litigation',
    typicalDuration: '12-36 months average',
    procedures: [
      {
        stepNumber: 1,
        name: 'Case Evaluation',
        description: 'Initial assessment of claims and potential outcomes',
        typicalTimeline: '1-2 weeks',
        requiredDocuments: ['Relevant contracts', 'Correspondence', 'Evidence of damages'],
      },
      {
        stepNumber: 2,
        name: 'Pre-Suit Demand',
        description: 'Formal demand letter before filing lawsuit',
        typicalTimeline: '2-4 weeks',
        requiredDocuments: ['Demand letter', 'Supporting documentation'],
      },
      {
        stepNumber: 3,
        name: 'Filing Complaint',
        description: 'Initiating lawsuit by filing complaint with court',
        typicalTimeline: '1-2 weeks to prepare',
        requiredDocuments: ['Complaint', 'Summons', 'Civil cover sheet'],
        fees: 'Filing fees vary by court and claim amount',
      },
      {
        stepNumber: 4,
        name: 'Discovery',
        description: 'Exchange of information through interrogatories, depositions, document requests',
        typicalTimeline: '6-12 months',
        requiredDocuments: ['Discovery requests', 'Document productions', 'Deposition transcripts'],
      },
      {
        stepNumber: 5,
        name: 'Motions Practice',
        description: 'Filing of dispositive and procedural motions',
        typicalTimeline: '2-6 months',
        requiredDocuments: ['Motion briefs', 'Supporting evidence'],
      },
      {
        stepNumber: 6,
        name: 'Settlement Negotiations/Mediation',
        description: 'Attempt to resolve case without trial',
        typicalTimeline: '1-3 months',
        requiredDocuments: ['Mediation statements', 'Settlement proposals'],
      },
      {
        stepNumber: 7,
        name: 'Trial',
        description: 'Presentation of case to judge or jury',
        typicalTimeline: '3-10 days',
        requiredDocuments: ['Trial exhibits', 'Witness lists', 'Trial briefs'],
      },
    ],
  },
};

/**
 * Common filing information template.
 */
const COMMON_FILING_INFO: CourtFilingInfo[] = [
  {
    filingType: 'Civil Complaint',
    courtLevel: 'State Trial Court',
    filingFee: 'Varies by jurisdiction and claim amount',
    requirements: ['Complaint with factual allegations', 'Summons', 'Civil cover sheet', 'Filing fee payment'],
    deadlines: ['Must be filed before statute of limitations expires'],
  },
  {
    filingType: 'Small Claims',
    courtLevel: 'Small Claims Court',
    filingFee: 'Typically lower than regular civil filing',
    requirements: ['Small claims form', 'Supporting documentation', 'Filing fee'],
    deadlines: ['Varies by jurisdiction', 'Usually quicker hearing dates'],
  },
  {
    filingType: 'Motion',
    courtLevel: 'All court levels',
    filingFee: 'Some courts require motion filing fees',
    requirements: ['Motion document', 'Memorandum of law', 'Proposed order', 'Proof of service'],
    deadlines: ['Filing deadlines set by court rules', 'Response deadlines after filing'],
  },
  {
    filingType: 'Appeal',
    courtLevel: 'Appellate Court',
    filingFee: 'Higher than trial court filing fees',
    requirements: ['Notice of appeal', 'Record on appeal', 'Appellate brief', 'Filing fee'],
    deadlines: ['Strict deadlines to file notice of appeal', 'Usually 30-60 days from judgment'],
  },
];

/**
 * Generates local court process information for legal services.
 *
 * @param input - BusinessInput with location and service information
 * @returns LocalCourtProcessOutput with court process details
 */
export function generateLocalCourtProcess(
  input: BusinessInput
): LocalCourtProcessOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { location, services } = input;

  // Build jurisdiction and court system strings
  const jurisdiction = buildJurisdictionString(location);
  const courtSystem = buildCourtSystemName(location);

  // Determine practice areas from services
  const practiceAreaKeys = determinePracticeAreas(services.primary);

  // Get templates for each practice area
  const practiceAreas = practiceAreaKeys.map(key => {
    const template = PRACTICE_AREA_TEMPLATES[key] || PRACTICE_AREA_TEMPLATES.general;
    return {
      area: template.area,
      procedures: template.procedures,
      typicalDuration: template.typicalDuration,
    };
  });

  // Generate court locations placeholder
  const courtLocations = generateCourtLocations(location);

  // Generate important deadlines
  const importantDeadlines = generateImportantDeadlines(practiceAreaKeys);

  return {
    jurisdiction,
    courtSystem,
    generatedAt: new Date().toISOString(),
    practiceAreas,
    filingInformation: COMMON_FILING_INFO,
    courtLocations,
    importantDeadlines,
    disclaimer: buildDisclaimer(jurisdiction),
    sources: ['BusinessInput', 'GeneralLegalProcedures'],
  };
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
 * Builds court system name based on location.
 */
function buildCourtSystemName(location: BusinessInput['location']): string {
  if (hasValue(location.region)) {
    return `${location.region} State Court System`;
  }
  return 'State Court System';
}

/**
 * Determines practice areas from services.
 */
function determinePracticeAreas(primaryServices: string[]): string[] {
  if (!hasItems(primaryServices)) {
    return ['general'];
  }

  const areas: string[] = [];
  const servicesLower = primaryServices.map(s => s.toLowerCase()).join(' ');

  if (servicesLower.includes('personal injury') || servicesLower.includes('accident') || servicesLower.includes('injury')) {
    areas.push('personal-injury');
  }
  if (servicesLower.includes('family') || servicesLower.includes('divorce') || servicesLower.includes('custody')) {
    areas.push('family-law');
  }
  if (servicesLower.includes('criminal') || servicesLower.includes('defense') || servicesLower.includes('dui') || servicesLower.includes('dwi')) {
    areas.push('criminal-defense');
  }
  if (servicesLower.includes('estate') || servicesLower.includes('wills') || servicesLower.includes('trust') || servicesLower.includes('probate')) {
    areas.push('estate-planning');
  }

  // Default to general if no specific matches
  if (areas.length === 0) {
    areas.push('general');
  }

  return areas;
}

/**
 * Generates placeholder court locations.
 */
function generateCourtLocations(
  location: BusinessInput['location']
): LocalCourtProcessOutput['courtLocations'] {
  const county = hasValue(location.primaryCity) ? location.primaryCity : 'Local';
  const region = hasValue(location.region) ? location.region : '';

  return [
    {
      name: `${county} County Superior Court`,
      address: `Contact ${county} County Clerk for address`,
      type: 'Superior Court / Trial Court',
      hoursOfOperation: 'Typically 8:00 AM - 5:00 PM, Monday-Friday',
    },
    {
      name: `${county} County District Court`,
      address: `Contact ${county} County Clerk for address`,
      type: 'District Court / Limited Jurisdiction',
      hoursOfOperation: 'Typically 8:00 AM - 5:00 PM, Monday-Friday',
    },
    {
      name: `${region} Court of Appeals`,
      address: `Contact ${region} Court of Appeals Clerk for address`,
      type: 'Appellate Court',
      hoursOfOperation: 'Typically 8:00 AM - 5:00 PM, Monday-Friday',
    },
  ];
}

/**
 * Generates important deadlines based on practice areas.
 */
function generateImportantDeadlines(
  practiceAreas: string[]
): LocalCourtProcessOutput['importantDeadlines'] {
  const deadlines: LocalCourtProcessOutput['importantDeadlines'] = [];

  if (practiceAreas.includes('personal-injury')) {
    deadlines.push({
      name: 'Personal Injury Statute of Limitations',
      description: 'Deadline to file personal injury lawsuit',
      statuteOfLimitations: 'Typically 2-3 years (varies by state)',
    });
  }

  if (practiceAreas.includes('family-law')) {
    deadlines.push({
      name: 'Response to Divorce Petition',
      description: 'Time to respond after being served',
      statuteOfLimitations: 'Typically 20-30 days',
    });
  }

  if (practiceAreas.includes('criminal-defense')) {
    deadlines.push({
      name: 'Speedy Trial Rights',
      description: 'Right to trial within specified timeframe',
      statuteOfLimitations: 'Varies by jurisdiction and charge type',
    });
  }

  // Add general deadlines
  deadlines.push({
    name: 'Notice of Appeal',
    description: 'Deadline to file appeal after judgment',
    statuteOfLimitations: 'Typically 30-60 days from judgment',
  });

  deadlines.push({
    name: 'Motion Response',
    description: 'Time to respond to filed motions',
    statuteOfLimitations: 'Typically 14-30 days (varies by court)',
  });

  return deadlines;
}

/**
 * Builds disclaimer text.
 */
function buildDisclaimer(jurisdiction: string): string {
  return `Court procedures and timelines for ${jurisdiction} are provided for general informational purposes only. Legal procedures vary significantly by jurisdiction, case type, and individual circumstances. This information does not constitute legal advice. For accurate information about court processes, filing requirements, and deadlines, please consult with a licensed attorney or contact the appropriate court clerk's office directly.`;
}
