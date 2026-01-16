/**
 * Rate Limiting Module
 *
 * Implements per-key rate limiting with plan-based limits.
 * Uses Durable Objects for distributed rate limiting state.
 *
 * LIMITS BY PLAN:
 *   free: 20 requests/day, 2 requests/minute burst
 *   pro:  500 requests/day, 30 requests/minute burst
 *
 * TIME WINDOWS:
 *   - Daily: UTC midnight to midnight
 *   - Minute: Rolling 60-second window
 */

import type { Plan } from './auth';

/**
 * Rate limit configuration per plan.
 */
export interface RateLimitConfig {
  dailyLimit: number;
  minuteLimit: number;
}

/**
 * Plan-specific rate limit configurations.
 */
export const RATE_LIMITS: Record<Plan, RateLimitConfig> = {
  free: {
    dailyLimit: 20,
    minuteLimit: 2,
  },
  pro: {
    dailyLimit: 500,
    minuteLimit: 30,
  },
};

/**
 * Current usage state for a key.
 */
export interface UsageState {
  keyId: string;
  plan: Plan;
  requestsToday: number;
  dailyLimit: number;
  minuteWindowCount: number;
  minuteWindowLimit: number;
}

/**
 * Rate limit check result - allowed.
 */
export interface RateLimitAllowed {
  allowed: true;
  usage: UsageState;
}

/**
 * Rate limit check result - blocked.
 */
export interface RateLimitBlocked {
  allowed: false;
  errorCode: 'DAILY_LIMIT_EXCEEDED' | 'MINUTE_LIMIT_EXCEEDED';
  message: string;
  retryAfterSeconds: number;
  usage: UsageState;
}

/**
 * Combined rate limit result type.
 */
export type RateLimitResult = RateLimitAllowed | RateLimitBlocked;

/**
 * Gets the current UTC day key (YYYY-MM-DD format).
 */
export function getUtcDayKey(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Gets the current UTC minute key (YYYY-MM-DDTHH:MM format).
 */
export function getUtcMinuteKey(): string {
  const now = new Date();
  return now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

/**
 * Calculates seconds until the next UTC midnight.
 */
export function secondsUntilMidnightUtc(): number {
  const now = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
}

/**
 * Calculates seconds until the next minute boundary.
 */
export function secondsUntilNextMinute(): number {
  const now = new Date();
  return 60 - now.getUTCSeconds();
}

/**
 * Message for rate limit exceeded.
 */
export interface RateLimitExceededMessage {
  type: 'daily' | 'minute';
  message: string;
  retryAfterSeconds: number;
}

/**
 * Creates rate limit exceeded message.
 */
export function createRateLimitMessage(type: 'daily' | 'minute'): RateLimitExceededMessage {
  if (type === 'daily') {
    return {
      type: 'daily',
      message: 'Daily rate limit exceeded. Please try again tomorrow.',
      retryAfterSeconds: secondsUntilMidnightUtc(),
    };
  }
  return {
    type: 'minute',
    message: 'Too many requests. Please slow down.',
    retryAfterSeconds: secondsUntilNextMinute(),
  };
}

/**
 * Interface for the Rate Limiter Durable Object stub.
 */
export interface RateLimiterStub {
  fetch(request: Request): Promise<Response>;
}

/**
 * Durable Object namespace interface.
 */
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): RateLimiterStub;
}

/**
 * Durable Object ID interface.
 */
export interface DurableObjectId {
  toString(): string;
}

/**
 * Checks rate limit using the Durable Object.
 */
export async function checkRateLimit(
  keyId: string,
  plan: Plan,
  rateLimiterNamespace: DurableObjectNamespace
): Promise<RateLimitResult> {
  // Get or create DO instance for this key
  const id = rateLimiterNamespace.idFromName(keyId);
  const stub = rateLimiterNamespace.get(id);

  // Make request to DO
  const limits = RATE_LIMITS[plan];
  const request = new Request('https://rate-limiter.internal/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyId,
      plan,
      dailyLimit: limits.dailyLimit,
      minuteLimit: limits.minuteLimit,
    }),
  });

  const response = await stub.fetch(request);
  const result = await response.json() as RateLimitResult;

  return result;
}

/**
 * Records a request for usage tracking (called after successful auth).
 * This is handled by the DO internally during checkRateLimit.
 */
export function recordRequest(): void {
  // No-op: Recording is handled by the Durable Object during checkRateLimit
}
