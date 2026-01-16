/**
 * FAQ Generator
 *
 * Generates structured FAQ content optimized for
 * FAQ schema markup and AI overview extraction.
 *
 * PROMPT LOGIC:
 * - Questions should match common user search patterns
 * - Answers must only use explicitly provided data
 * - Format for FAQ schema compatibility
 * - Include location-specific questions for local SEO
 * - Never fabricate answers to questions we can't answer
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
  hasPositiveNumber,
  missingDataPlaceholder,
} from '../rules/antiHallucination';

export interface FAQItem {
  question: string;
  answer: string;
  category: 'location' | 'services' | 'credentials' | 'operations' | 'contact';
  canAnswer: boolean;
}

export interface FAQOutput {
  faqs: FAQItem[];
  schemaReady: FAQItem[];
  unanswerable: string[];
  sources: string[];
}

/**
 * Generates FAQ content from BusinessInput.
 * Only generates answerable questions based on available data.
 */
export function generateFAQ(input: BusinessInput): FAQOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { business, location, services, credentials, operations, contact } = input;

  const faqs: FAQItem[] = [];
  const unanswerable: string[] = [];

  const businessName = hasValue(business.name)
    ? business.name
    : missingDataPlaceholder('business.name');

  // PROMPT LOGIC: Location-based questions
  if (hasValue(location.primaryCity)) {
    faqs.push({
      question: `Where is ${businessName} located?`,
      answer: `${businessName} is located in ${location.primaryCity}${hasValue(location.region) ? `, ${location.region}` : ''}${hasValue(location.country) ? `, ${location.country}` : ''}.`,
      category: 'location',
      canAnswer: true,
    });
  } else {
    unanswerable.push('Location question - missing primaryCity');
  }

  // PROMPT LOGIC: Service area questions
  if (hasItems(location.serviceAreas)) {
    faqs.push({
      question: `What areas does ${businessName} serve?`,
      answer: `${businessName} serves the following areas: ${location.serviceAreas.join(', ')}.`,
      category: 'location',
      canAnswer: true,
    });
  }

  // PROMPT LOGIC: Services questions
  if (hasItems(services.primary)) {
    faqs.push({
      question: `What services does ${businessName} offer?`,
      answer: `${businessName} offers ${services.primary.join(', ')}${hasItems(services.secondary) ? `, as well as ${services.secondary.join(', ')}` : ''}.`,
      category: 'services',
      canAnswer: true,
    });
  } else {
    unanswerable.push('Services question - missing primary services');
  }

  // PROMPT LOGIC: Credentials questions - only if data exists
  if (hasValue(credentials)) {
    if (hasPositiveNumber(credentials.yearsOperating)) {
      faqs.push({
        question: `How long has ${businessName} been in business?`,
        answer: `${businessName} has been operating for ${credentials.yearsOperating} years.`,
        category: 'credentials',
        canAnswer: true,
      });
    }

    if (hasItems(credentials.licenses)) {
      faqs.push({
        question: `Is ${businessName} licensed?`,
        answer: `Yes, ${businessName} holds the following licenses: ${credentials.licenses.join(', ')}.`,
        category: 'credentials',
        canAnswer: true,
      });
    }

    if (hasValue(credentials.insurance)) {
      faqs.push({
        question: `Is ${businessName} insured?`,
        answer: `Yes, ${businessName} carries ${credentials.insurance} insurance.`,
        category: 'credentials',
        canAnswer: true,
      });
    }
  }

  // PROMPT LOGIC: Operations questions - only if data exists
  if (hasValue(operations)) {
    if (hasValue(operations.operatingHours)) {
      faqs.push({
        question: `What are ${businessName}'s hours of operation?`,
        answer: `${businessName} operates ${operations.operatingHours}.`,
        category: 'operations',
        canAnswer: true,
      });
    }

    if (operations.emergencyService === true) {
      faqs.push({
        question: `Does ${businessName} offer emergency services?`,
        answer: `Yes, ${businessName} offers emergency services.`,
        category: 'operations',
        canAnswer: true,
      });
    }
  }

  // PROMPT LOGIC: Contact questions - only if data exists
  if (hasValue(contact)) {
    if (hasValue(contact.phone)) {
      faqs.push({
        question: `How can I contact ${businessName}?`,
        answer: `You can reach ${businessName} by phone at ${contact.phone}${hasValue(contact.email) ? ` or by email at ${contact.email}` : ''}.`,
        category: 'contact',
        canAnswer: true,
      });
    } else if (hasValue(contact.email)) {
      faqs.push({
        question: `How can I contact ${businessName}?`,
        answer: `You can reach ${businessName} by email at ${contact.email}.`,
        category: 'contact',
        canAnswer: true,
      });
    }
  }

  // Filter to only schema-ready FAQs (those we can actually answer)
  const schemaReady = faqs.filter(faq => faq.canAnswer);

  return {
    faqs,
    schemaReady,
    unanswerable,
    sources: ['BusinessInput'],
  };
}
