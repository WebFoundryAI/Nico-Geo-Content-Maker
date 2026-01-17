/**
 * How We Work / Service Process Generator
 *
 * Generates a step-by-step service process/workflow.
 * Shows customers what to expect. Builds trust through transparency.
 *
 * PROMPT LOGIC:
 * - Use provided process steps if available
 * - Generate sensible defaults based on service type if not provided
 * - Include timeline information when available
 * - Handle emergency service info if applicable
 * - Never fabricate specific timelines not provided
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
} from '../rules/antiHallucination';

export interface ProcessStep {
  stepNumber: number;
  title: string;
  description: string;
  timeline: string;
  expectations: string[];
}

export interface HowWeWorkOutput {
  intro: string;
  steps: ProcessStep[];
  totalTimeline: string;
  emergencyOption?: {
    available: boolean;
    timeline: string;
    description: string;
  };
  sources: string[];
}

/**
 * Default process steps when no specific process is provided.
 * These are generic enough to apply to most service businesses.
 */
const DEFAULT_PROCESS_STEPS = [
  {
    title: 'Initial Contact',
    description: 'Reach out to discuss your needs and schedule a consultation.',
    timeline: 'Same day response',
    expectations: ['Describe your requirements', 'Ask questions about services'],
  },
  {
    title: 'Assessment & Quote',
    description: 'Professional evaluation of your needs and transparent pricing.',
    timeline: 'Within consultation',
    expectations: ['Receive detailed assessment', 'Review pricing options'],
  },
  {
    title: 'Service Delivery',
    description: 'Professional execution of the agreed-upon services.',
    timeline: 'As scheduled',
    expectations: ['Timely service delivery', 'Quality workmanship'],
  },
  {
    title: 'Follow-Up',
    description: 'Ensure satisfaction and address any questions or concerns.',
    timeline: 'After completion',
    expectations: ['Review completed work', 'Provide feedback'],
  },
];

/**
 * Generates "How We Work" content from BusinessInput.
 * Creates structured process steps for customer transparency.
 */
export function generateHowWeWork(input: BusinessInput): HowWeWorkOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { business, location, services, operations } = input;

  // Build location context
  const primaryLocation = hasValue(location.primaryCity)
    ? `${location.primaryCity}${hasValue(location.region) ? `, ${location.region}` : ''}`
    : '';

  // Get primary service for contextualization
  const primaryService = hasItems(services.primary) ? services.primary[0] : 'service';

  // Determine if we have provided process steps
  const serviceProcess = operations?.serviceProcess;
  const hasProvidedSteps = serviceProcess && hasItems(serviceProcess.steps);

  // Build process steps
  const steps: ProcessStep[] = hasProvidedSteps
    ? buildStepsFromProvided(serviceProcess.steps, primaryLocation)
    : buildDefaultSteps(primaryService, primaryLocation);

  // Build intro
  const intro = buildIntro(business.name, primaryService, primaryLocation, steps.length);

  // Determine total timeline
  const totalTimeline = hasValue(serviceProcess?.totalTimeline)
    ? serviceProcess.totalTimeline
    : 'Varies by service';

  // Handle emergency option
  const emergencyOption = buildEmergencyOption(operations, primaryLocation);

  return {
    intro,
    steps,
    totalTimeline,
    emergencyOption,
    sources: ['BusinessInput'],
  };
}

/**
 * Builds process steps from provided service process data.
 */
function buildStepsFromProvided(
  providedSteps: NonNullable<NonNullable<BusinessInput['operations']>['serviceProcess']>['steps'],
  location: string
): ProcessStep[] {
  return providedSteps.map((step, index) => ({
    stepNumber: index + 1,
    title: step.title,
    description: step.description,
    timeline: step.timeline,
    expectations: generateExpectations(step.title, step.description, location),
  }));
}

/**
 * Builds default process steps when none are provided.
 */
function buildDefaultSteps(primaryService: string, location: string): ProcessStep[] {
  return DEFAULT_PROCESS_STEPS.map((step, index) => ({
    stepNumber: index + 1,
    title: step.title,
    description: contextualizeDescription(step.description, primaryService, location),
    timeline: step.timeline,
    expectations: step.expectations,
  }));
}

/**
 * Generates expectations for a process step based on title and description.
 */
function generateExpectations(title: string, description: string, location: string): string[] {
  const expectations: string[] = [];

  // Generate contextual expectations based on step type
  const titleLower = title.toLowerCase();

  if (titleLower.includes('contact') || titleLower.includes('call') || titleLower.includes('reach')) {
    expectations.push('Prompt response to your inquiry');
    expectations.push('Initial consultation scheduling');
  } else if (titleLower.includes('assess') || titleLower.includes('evaluat') || titleLower.includes('quote')) {
    expectations.push('Thorough evaluation of your needs');
    expectations.push('Transparent pricing information');
  } else if (titleLower.includes('service') || titleLower.includes('work') || titleLower.includes('install')) {
    expectations.push('Professional service delivery');
    expectations.push('Quality workmanship');
  } else if (titleLower.includes('follow') || titleLower.includes('review') || titleLower.includes('complete')) {
    expectations.push('Review of completed work');
    expectations.push('Opportunity to provide feedback');
  } else {
    // Generic expectations
    expectations.push('Clear communication');
    expectations.push('Professional service');
  }

  return expectations;
}

/**
 * Contextualizes a description with service and location info.
 */
function contextualizeDescription(
  description: string,
  primaryService: string,
  location: string
): string {
  let contextualized = description;

  // Add location context if available
  if (location && !description.includes(location)) {
    // Don't add location to every description, just where it makes sense
    if (description.toLowerCase().includes('reach out') || description.toLowerCase().includes('contact')) {
      contextualized = description.replace('.', ` for ${primaryService} in ${location}.`);
    }
  }

  return contextualized;
}

/**
 * Builds the introduction paragraph.
 */
function buildIntro(
  businessName: string,
  primaryService: string,
  location: string,
  stepCount: number
): string {
  const parts: string[] = [];

  parts.push(`At ${businessName}, we believe in a transparent and straightforward process.`);
  parts.push(`Our ${stepCount}-step approach ensures quality ${primaryService} delivery${location ? ` for ${location} customers` : ''}.`);
  parts.push('Here\'s what you can expect when you work with us.');

  return parts.join(' ');
}

/**
 * Builds emergency option information if available.
 */
function buildEmergencyOption(
  operations: BusinessInput['operations'],
  location: string
): HowWeWorkOutput['emergencyOption'] | undefined {
  // Check both emergencyService flag and serviceProcess.emergencyAvailable
  const hasEmergencyService = operations?.emergencyService === true;
  const processEmergency = operations?.serviceProcess?.emergencyAvailable === true;

  if (!hasEmergencyService && !processEmergency) {
    return undefined;
  }

  const emergencyTimeline = hasValue(operations?.serviceProcess?.emergencyTimeline)
    ? operations.serviceProcess.emergencyTimeline
    : '24/7 availability';

  return {
    available: true,
    timeline: emergencyTimeline,
    description: location
      ? `Emergency service available for ${location} customers requiring immediate assistance.`
      : 'Emergency service available for customers requiring immediate assistance.',
  };
}
