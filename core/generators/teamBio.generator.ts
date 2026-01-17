/**
 * Team Bio Generator
 *
 * Generates individual bios for team members highlighting credentials,
 * experience, and local expertise. Makes team members seem real and credible.
 *
 * PROMPT LOGIC:
 * - Only generate if team data is provided
 * - Extract credentials, years, and specialties for each member
 * - Generate contextual bios using provided data
 * - Never fabricate team members or credentials
 */

import type { BusinessInput } from '../../inputs/business.schema';
import {
  enforceNoHallucinations,
  hasValue,
  hasItems,
  hasPositiveNumber,
} from '../rules/antiHallucination';

export interface TeamMemberBio {
  name: string;
  role: string;
  bio: string;
  credentials: string[];
  specialties: string[];
  yearsExperience: number;
  trustSignals: string[];
  sources: string[];
}

export interface TeamBioOutput {
  team: TeamMemberBio[];
  teamSummary: string;
  sources: string[];
}

/**
 * Generates team bios from BusinessInput.
 * Returns empty team array if no team data is provided (no hallucination).
 */
export function generateTeamBio(
  input: BusinessInput,
  includedMembers?: string[]
): TeamBioOutput {
  // Enforce anti-hallucination rules
  enforceNoHallucinations(input);

  const { business, location, team } = input;

  // If no team data provided, return empty output
  if (!team || !hasItems(team.members)) {
    return {
      team: [],
      teamSummary: '',
      sources: ['BusinessInput'],
    };
  }

  // Build location context
  const primaryLocation = hasValue(location.primaryCity)
    ? `${location.primaryCity}${hasValue(location.region) ? `, ${location.region}` : ''}`
    : '';

  const teamBios: TeamMemberBio[] = [];

  for (const member of team.members) {
    // Skip if filtering by specific members and this one isn't included
    if (includedMembers && !includedMembers.includes(member.name)) {
      continue;
    }

    // Validate required fields
    if (!hasValue(member.name) || !hasValue(member.role)) {
      continue; // Skip members with missing required data
    }

    const bio = buildMemberBio(member, business.name, primaryLocation);
    const credentials = buildCredentialsList(member);
    const specialties = hasItems(member.specialties) ? member.specialties : [];
    const trustSignals = buildTrustSignals(member);
    const yearsExperience = hasPositiveNumber(member.yearsExperience) ? member.yearsExperience : 0;

    teamBios.push({
      name: member.name,
      role: member.role,
      bio,
      credentials,
      specialties,
      yearsExperience,
      trustSignals,
      sources: ['BusinessInput'],
    });
  }

  // Build team summary
  const teamSummary = buildTeamSummary(teamBios, business.name, primaryLocation);

  return {
    team: teamBios,
    teamSummary,
    sources: ['BusinessInput'],
  };
}

/**
 * Builds a professional bio for a team member.
 */
function buildMemberBio(
  member: NonNullable<BusinessInput['team']>['members'][0],
  businessName: string,
  location: string
): string {
  const parts: string[] = [];

  // Opening with name and role
  parts.push(`${member.name} serves as ${member.role} at ${businessName}.`);

  // Add years of experience if provided
  if (hasPositiveNumber(member.yearsExperience)) {
    const years = member.yearsExperience;
    const experienceText = years === 1 ? '1 year' : `${years} years`;
    parts.push(`With ${experienceText} of professional experience, ${member.name} brings proven expertise to every project.`);
  }

  // Add specialties if provided
  if (hasItems(member.specialties)) {
    const specialtiesList = member.specialties.slice(0, 3).join(', ');
    parts.push(`Specializing in ${specialtiesList}${member.specialties.length > 3 ? ' and more' : ''}.`);
  }

  // Add licenses if provided
  if (hasItems(member.licenses)) {
    const licenseCount = member.licenses.length;
    parts.push(`Holds ${licenseCount} professional license${licenseCount > 1 ? 's' : ''}.`);
  }

  // Add certifications if provided
  if (hasItems(member.certifications)) {
    const certCount = member.certifications.length;
    parts.push(`Maintains ${certCount} industry certification${certCount > 1 ? 's' : ''}.`);
  }

  // Add location context
  if (location) {
    parts.push(`Committed to serving ${location} customers with excellence.`);
  }

  // Use existing bio if provided (append to generated content)
  if (hasValue(member.bio)) {
    parts.push(member.bio);
  }

  return parts.join(' ');
}

/**
 * Builds a list of credentials from member data.
 */
function buildCredentialsList(
  member: NonNullable<BusinessInput['team']>['members'][0]
): string[] {
  const credentials: string[] = [];

  if (hasItems(member.licenses)) {
    credentials.push(...member.licenses.map(l => `License: ${l}`));
  }

  if (hasItems(member.certifications)) {
    credentials.push(...member.certifications.map(c => `Certification: ${c}`));
  }

  return credentials;
}

/**
 * Builds trust signals from member data.
 */
function buildTrustSignals(
  member: NonNullable<BusinessInput['team']>['members'][0]
): string[] {
  const signals: string[] = [];

  if (hasPositiveNumber(member.yearsExperience)) {
    signals.push(`${member.yearsExperience}+ years experience`);
  }

  if (hasItems(member.licenses)) {
    signals.push(`Licensed professional`);
  }

  if (hasItems(member.certifications)) {
    signals.push(`Certified specialist`);
  }

  if (hasItems(member.specialties)) {
    signals.push(`${member.specialties.length} area${member.specialties.length > 1 ? 's' : ''} of specialty`);
  }

  return signals;
}

/**
 * Builds a team summary sentence.
 */
function buildTeamSummary(
  teamBios: TeamMemberBio[],
  businessName: string,
  location: string
): string {
  if (teamBios.length === 0) {
    return '';
  }

  const totalYears = teamBios.reduce((sum, member) => sum + member.yearsExperience, 0);
  const totalCredentials = teamBios.reduce((sum, member) => sum + member.credentials.length, 0);

  const parts: string[] = [];

  parts.push(`The ${businessName} team consists of ${teamBios.length} professional${teamBios.length > 1 ? 's' : ''}`);

  if (totalYears > 0) {
    parts.push(`with a combined ${totalYears} years of experience`);
  }

  if (totalCredentials > 0) {
    parts.push(`and ${totalCredentials} verified credential${totalCredentials > 1 ? 's' : ''}`);
  }

  if (location) {
    parts.push(`serving ${location}`);
  }

  return parts.join(' ') + '.';
}
