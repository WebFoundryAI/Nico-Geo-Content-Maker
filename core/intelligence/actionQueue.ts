/**
 * Action Queue Generator
 *
 * Generates a prioritized action queue from scored pages.
 * Each action includes recommended next steps and evidence.
 *
 * RECOMMENDED ACTIONS:
 * - add_answer_capsule: Page lacks direct answer content
 * - add_faq: Page has no FAQ section
 * - add_schema: Page lacks schema.org markup
 * - improve_meta: Title/description needs GEO optimization
 * - increase_depth: Content is thin, needs expansion
 * - fix_internal_links: Page has poor internal linking
 *
 * ACTION SELECTION LOGIC:
 * - Based on gap flags and GSC signals
 * - Prioritizes high-impact, achievable improvements
 * - One primary action per page (most impactful)
 */

import type { ScoredPage, ScoreBreakdown } from './opportunityScorer';

/**
 * Possible recommended actions.
 */
export type RecommendedAction =
  | 'add_answer_capsule'
  | 'add_faq'
  | 'add_schema'
  | 'improve_meta'
  | 'increase_depth'
  | 'fix_internal_links';

/**
 * A single item in the action queue.
 */
export interface ActionQueueItem {
  /** Full URL */
  url: string;
  /** Normalized path */
  path: string;
  /** Total opportunity score */
  totalScore: number;
  /** Breakdown of score components */
  scoreBreakdown: ScoreBreakdown;
  /** Primary recommended action */
  recommendedNextAction: RecommendedAction;
  /** Evidence strings explaining the ranking */
  evidence: string[];
}

/**
 * Complete action queue result.
 */
export interface ActionQueueResult {
  /** Sorted action items (highest opportunity first) */
  items: ActionQueueItem[];
  /** Total pages analyzed */
  totalPagesAnalyzed: number;
  /** Pages with GSC data */
  pagesWithGscData: number;
  /** Average opportunity score */
  averageScore: number;
}

/**
 * Determines the primary recommended action based on gaps and signals.
 */
function determineRecommendedAction(
  gapFlags: string[],
  scoreBreakdown: ScoreBreakdown
): RecommendedAction {
  // Priority order based on impact and common issues

  // 1. If low CTR, improve meta first (high impact on clicks)
  if (scoreBreakdown.ctrOpportunityScore >= 10) {
    const hasMetaGap = gapFlags.some(f =>
      f.includes('title') || f.includes('meta') || f.includes('description')
    );
    if (hasMetaGap) {
      return 'improve_meta';
    }
  }

  // 2. If missing answer capsule (good for featured snippets)
  if (gapFlags.some(f => f.includes('answer_capsule') || f.includes('capsule'))) {
    return 'add_answer_capsule';
  }

  // 3. If missing FAQ (good for PAA boxes)
  if (gapFlags.some(f => f.includes('faq'))) {
    return 'add_faq';
  }

  // 4. If missing schema (helps rich results)
  if (gapFlags.some(f => f.includes('schema') || f.includes('structured_data'))) {
    return 'add_schema';
  }

  // 5. If content depth issues
  if (gapFlags.some(f => f.includes('content') || f.includes('depth') || f.includes('thin'))) {
    return 'increase_depth';
  }

  // 6. If internal linking issues
  if (gapFlags.some(f => f.includes('link') || f.includes('navigation'))) {
    return 'fix_internal_links';
  }

  // 7. Default: improve meta (always beneficial)
  if (gapFlags.some(f => f.includes('title') || f.includes('meta'))) {
    return 'improve_meta';
  }

  // 8. Fallback based on highest gap score component
  if (scoreBreakdown.geoGapScore > 25) {
    return 'add_answer_capsule'; // Generic high-impact action
  }

  return 'improve_meta'; // Safe default
}

/**
 * Generates evidence strings explaining why a page ranks high.
 */
function generateEvidence(
  scoredPage: ScoredPage
): string[] {
  const evidence: string[] = [];
  const { scoreBreakdown, gscMetrics, geoScore } = scoredPage;

  // GEO gap evidence
  if (scoreBreakdown.geoGapScore >= 30) {
    evidence.push(`Low GEO score (${geoScore}/100) indicates significant optimization gaps`);
  } else if (scoreBreakdown.geoGapScore >= 20) {
    evidence.push(`Moderate GEO score (${geoScore}/100) with room for improvement`);
  }

  // GSC-based evidence
  if (gscMetrics) {
    // Impression evidence
    if (gscMetrics.impressions >= 1000) {
      evidence.push(`High visibility: ${gscMetrics.impressions.toLocaleString()} impressions`);
    } else if (gscMetrics.impressions >= 500) {
      evidence.push(`Moderate visibility: ${gscMetrics.impressions.toLocaleString()} impressions`);
    }

    // CTR evidence
    if (scoreBreakdown.ctrOpportunityScore >= 10) {
      const ctrPercent = (gscMetrics.ctr * 100).toFixed(1);
      evidence.push(`Low CTR (${ctrPercent}%) despite impressions suggests title/meta opportunity`);
    }

    // Position evidence
    if (scoreBreakdown.strikingDistanceScore >= 10) {
      const posRounded = gscMetrics.position.toFixed(1);
      evidence.push(`Position ${posRounded} is within striking distance of top results`);
    }

    // Depth evidence
    if (scoreBreakdown.depthOpportunityScore > 0) {
      evidence.push('High impressions with content gaps indicates depth opportunity');
    }
  } else {
    evidence.push('No GSC data; score based on GEO gap analysis only');
  }

  // Gap-specific evidence
  if (scoredPage.gapFlags.length > 0) {
    const flagSummary = scoredPage.gapFlags.slice(0, 3).join(', ');
    evidence.push(`Gap flags: ${flagSummary}`);
  }

  return evidence;
}

/**
 * Generates an action queue from scored pages.
 */
export function generateActionQueue(
  scoredPages: ScoredPage[]
): ActionQueueResult {
  const items: ActionQueueItem[] = [];
  let pagesWithGscData = 0;
  let totalScore = 0;

  for (const page of scoredPages) {
    if (page.gscMetrics) {
      pagesWithGscData++;
    }
    totalScore += page.totalScore;

    const item: ActionQueueItem = {
      url: page.url,
      path: page.path,
      totalScore: page.totalScore,
      scoreBreakdown: page.scoreBreakdown,
      recommendedNextAction: determineRecommendedAction(page.gapFlags, page.scoreBreakdown),
      evidence: generateEvidence(page),
    };

    items.push(item);
  }

  const averageScore = scoredPages.length > 0 ? totalScore / scoredPages.length : 0;

  return {
    items,
    totalPagesAnalyzed: scoredPages.length,
    pagesWithGscData,
    averageScore,
  };
}

/**
 * Selects top N pages from action queue for targeting.
 */
export function selectTopTargets(
  actionQueue: ActionQueueResult,
  maxTargets: number
): string[] {
  // Items are already sorted by score descending
  const topItems = actionQueue.items.slice(0, maxTargets);
  return topItems.map(item => item.path);
}

/**
 * Filters action queue to only include specified paths.
 */
export function filterActionQueueByPaths(
  actionQueue: ActionQueueResult,
  paths: string[]
): ActionQueueResult {
  const pathSet = new Set(paths.map(p => p.toLowerCase()));

  const filteredItems = actionQueue.items.filter(item =>
    pathSet.has(item.path.toLowerCase())
  );

  const pagesWithGscData = filteredItems.filter(i => i.scoreBreakdown.hasGscData).length;
  const totalScore = filteredItems.reduce((sum, i) => sum + i.totalScore, 0);
  const averageScore = filteredItems.length > 0 ? totalScore / filteredItems.length : 0;

  return {
    items: filteredItems,
    totalPagesAnalyzed: filteredItems.length,
    pagesWithGscData,
    averageScore,
  };
}
