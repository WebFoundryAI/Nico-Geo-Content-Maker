/**
 * Opportunity Scorer
 *
 * Deterministic scoring function that ranks pages by improvement opportunity.
 * Combines GEO gap analysis with GSC performance signals.
 *
 * ============================================
 * SCORING MODEL (DETERMINISTIC)
 * ============================================
 *
 * Total Score = GEO_SCORE + GSC_SCORE
 *
 * GEO_SCORE (0-50 points):
 *   - Based on existing GEO gaps severity
 *   - geoScore (0-100) inverted: (100 - geoScore) * 0.5
 *   - Lower GEO score = more gaps = higher opportunity
 *
 * GSC_SCORE (0-50 points, only when GSC data present):
 *   Components:
 *
 *   1. IMPRESSION_SCORE (0-15 points):
 *      - High impressions = visibility = worth optimizing
 *      - 0-100 impressions: 0 points
 *      - 100-500 impressions: 5 points
 *      - 500-1000 impressions: 10 points
 *      - 1000+ impressions: 15 points
 *
 *   2. CTR_OPPORTUNITY_SCORE (0-15 points):
 *      - Low CTR with impressions = title/meta opportunity
 *      - CTR < 1% with impressions > 100: 15 points
 *      - CTR 1-3% with impressions > 100: 10 points
 *      - CTR 3-5% with impressions > 100: 5 points
 *      - CTR >= 5% or low impressions: 0 points
 *
 *   3. STRIKING_DISTANCE_SCORE (0-15 points):
 *      - Position 4-20 = can realistically move to top 3
 *      - Position 4-10: 15 points (easy striking distance)
 *      - Position 11-20: 10 points (moderate striking distance)
 *      - Position 21-30: 5 points (hard but possible)
 *      - Position > 30 or < 4: 0 points
 *
 *   4. DEPTH_OPPORTUNITY_SCORE (0-5 points):
 *      - High impressions but low depth (from GEO gaps) = content opportunity
 *      - Impressions > 500 AND content depth gaps: 5 points
 *
 * THRESHOLDS (explicit constants):
 */

import type { AggregatedGscMetrics } from './gscSnapshot.normalise';
import type { PageGapAnalysis } from '../analyze/geoGapAnalyzer';

/**
 * Impression thresholds for scoring.
 */
const IMPRESSION_THRESHOLD_LOW = 100;
const IMPRESSION_THRESHOLD_MEDIUM = 500;
const IMPRESSION_THRESHOLD_HIGH = 1000;

/**
 * CTR thresholds (as decimals, e.g., 0.01 = 1%).
 */
const CTR_THRESHOLD_VERY_LOW = 0.01;
const CTR_THRESHOLD_LOW = 0.03;
const CTR_THRESHOLD_MODERATE = 0.05;

/**
 * Position thresholds for striking distance.
 */
const POSITION_ALREADY_TOP = 4;
const POSITION_EASY_STRIKE = 10;
const POSITION_MODERATE_STRIKE = 20;
const POSITION_HARD_STRIKE = 30;

/**
 * Score weights (points).
 */
const MAX_GEO_SCORE = 50;
const MAX_IMPRESSION_SCORE = 15;
const MAX_CTR_SCORE = 15;
const MAX_POSITION_SCORE = 15;
const MAX_DEPTH_SCORE = 5;

/**
 * Breakdown of individual score components.
 */
export interface ScoreBreakdown {
  /** GEO gap severity score (0-50) */
  geoGapScore: number;
  /** Impression volume score (0-15) */
  impressionScore: number;
  /** CTR opportunity score (0-15) */
  ctrOpportunityScore: number;
  /** Striking distance score (0-15) */
  strikingDistanceScore: number;
  /** Content depth opportunity score (0-5) */
  depthOpportunityScore: number;
  /** Whether GSC data was available */
  hasGscData: boolean;
}

/**
 * Scored page with total and breakdown.
 */
export interface ScoredPage {
  /** Full URL */
  url: string;
  /** Normalized path */
  path: string;
  /** Total opportunity score */
  totalScore: number;
  /** Breakdown of score components */
  scoreBreakdown: ScoreBreakdown;
  /** Original GEO score (0-100, higher = better) */
  geoScore: number;
  /** GSC metrics (if available) */
  gscMetrics: AggregatedGscMetrics | null;
  /** Gap flags from GEO analysis */
  gapFlags: string[];
}

/**
 * Input for scoring a single page.
 */
export interface PageScoringInput {
  url: string;
  path: string;
  geoScore: number;
  gapFlags: string[];
  gscMetrics: AggregatedGscMetrics | null;
}

/**
 * Calculates the GEO gap score component.
 * Lower GEO score = more gaps = higher opportunity.
 */
function calculateGeoGapScore(geoScore: number): number {
  // Invert: 100 - geoScore, then scale to 0-50
  const inverted = 100 - Math.max(0, Math.min(100, geoScore));
  return (inverted / 100) * MAX_GEO_SCORE;
}

/**
 * Calculates the impression volume score.
 */
function calculateImpressionScore(impressions: number): number {
  if (impressions >= IMPRESSION_THRESHOLD_HIGH) {
    return MAX_IMPRESSION_SCORE; // 15 points
  }
  if (impressions >= IMPRESSION_THRESHOLD_MEDIUM) {
    return 10;
  }
  if (impressions >= IMPRESSION_THRESHOLD_LOW) {
    return 5;
  }
  return 0;
}

/**
 * Calculates the CTR opportunity score.
 * Low CTR with impressions = high opportunity.
 */
function calculateCtrOpportunityScore(ctr: number, impressions: number): number {
  // Only score if we have meaningful impressions
  if (impressions < IMPRESSION_THRESHOLD_LOW) {
    return 0;
  }

  if (ctr < CTR_THRESHOLD_VERY_LOW) {
    return MAX_CTR_SCORE; // 15 points - very low CTR
  }
  if (ctr < CTR_THRESHOLD_LOW) {
    return 10; // Low CTR
  }
  if (ctr < CTR_THRESHOLD_MODERATE) {
    return 5; // Moderate CTR
  }
  return 0; // Good CTR
}

/**
 * Calculates the striking distance score.
 * Positions 4-20 are the sweet spot.
 */
function calculateStrikingDistanceScore(position: number): number {
  if (position < POSITION_ALREADY_TOP) {
    return 0; // Already top 3, not much room to improve
  }
  if (position <= POSITION_EASY_STRIKE) {
    return MAX_POSITION_SCORE; // 15 points - easy striking distance (4-10)
  }
  if (position <= POSITION_MODERATE_STRIKE) {
    return 10; // Moderate striking distance (11-20)
  }
  if (position <= POSITION_HARD_STRIKE) {
    return 5; // Hard but possible (21-30)
  }
  return 0; // Too far down
}

/**
 * Calculates the depth opportunity score.
 * High impressions + content gaps = big opportunity.
 */
function calculateDepthOpportunityScore(
  impressions: number,
  gapFlags: string[]
): number {
  // Check for content depth gaps
  const hasDepthGaps = gapFlags.some(flag =>
    flag.includes('faq') ||
    flag.includes('answer_capsule') ||
    flag.includes('schema') ||
    flag.includes('content_depth')
  );

  if (impressions >= IMPRESSION_THRESHOLD_MEDIUM && hasDepthGaps) {
    return MAX_DEPTH_SCORE; // 5 points
  }

  return 0;
}

/**
 * Scores a single page for improvement opportunity.
 */
export function scorePage(input: PageScoringInput): ScoredPage {
  const { url, path, geoScore, gapFlags, gscMetrics } = input;

  // Calculate GEO gap score (always available)
  const geoGapScore = calculateGeoGapScore(geoScore);

  // Calculate GSC-based scores (only when data available)
  let impressionScore = 0;
  let ctrOpportunityScore = 0;
  let strikingDistanceScore = 0;
  let depthOpportunityScore = 0;

  if (gscMetrics) {
    impressionScore = calculateImpressionScore(gscMetrics.impressions);
    ctrOpportunityScore = calculateCtrOpportunityScore(gscMetrics.ctr, gscMetrics.impressions);
    strikingDistanceScore = calculateStrikingDistanceScore(gscMetrics.position);
    depthOpportunityScore = calculateDepthOpportunityScore(gscMetrics.impressions, gapFlags);
  }

  // Total score
  const totalScore =
    geoGapScore +
    impressionScore +
    ctrOpportunityScore +
    strikingDistanceScore +
    depthOpportunityScore;

  const scoreBreakdown: ScoreBreakdown = {
    geoGapScore,
    impressionScore,
    ctrOpportunityScore,
    strikingDistanceScore,
    depthOpportunityScore,
    hasGscData: gscMetrics !== null,
  };

  return {
    url,
    path,
    totalScore,
    scoreBreakdown,
    geoScore,
    gscMetrics,
    gapFlags,
  };
}

/**
 * Scores multiple pages and returns them sorted by opportunity (descending).
 */
export function scorePages(inputs: PageScoringInput[]): ScoredPage[] {
  const scored = inputs.map(scorePage);

  // Sort by totalScore descending, then by path for stability
  scored.sort((a, b) => {
    if (b.totalScore !== a.totalScore) {
      return b.totalScore - a.totalScore;
    }
    return a.path.localeCompare(b.path);
  });

  return scored;
}

/**
 * Extracts gap flags from a PageGapAnalysis.
 */
export function extractGapFlags(gaps: PageGapAnalysis): string[] {
  const flags: string[] = [];

  for (const gap of gaps.gaps) {
    flags.push(gap.type);
  }

  return flags;
}
