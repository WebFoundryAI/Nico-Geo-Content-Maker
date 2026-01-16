/**
 * Rate Limiter Durable Object
 *
 * Manages per-key rate limiting state with daily and per-minute windows.
 * Each API key gets its own Durable Object instance for isolated state.
 *
 * STATE STRUCTURE:
 *   - dayKey: Current UTC day (YYYY-MM-DD)
 *   - dayCount: Requests made today
 *   - minuteKey: Current UTC minute (YYYY-MM-DDTHH:MM)
 *   - minuteCount: Requests in current minute
 */

import type { Plan } from './auth';
import type { UsageState, RateLimitResult } from './rateLimit';
import {
  getUtcDayKey,
  getUtcMinuteKey,
  secondsUntilMidnightUtc,
  secondsUntilNextMinute,
} from './rateLimit';

/**
 * Durable Object state interface.
 */
interface DurableObjectState {
  storage: DurableObjectStorage;
}

/**
 * Durable Object storage interface.
 */
interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/**
 * Request body for rate limit check.
 */
interface CheckRequest {
  keyId: string;
  plan: Plan;
  dailyLimit: number;
  minuteLimit: number;
}

/**
 * Internal state for rate limiting.
 */
interface RateLimitState {
  dayKey: string;
  dayCount: number;
  minuteKey: string;
  minuteCount: number;
}

/**
 * Rate Limiter Durable Object class.
 *
 * Exported for Cloudflare Workers binding.
 */
export class RateLimiterDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Handles incoming requests to the Durable Object.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/check' && request.method === 'POST') {
      return this.handleCheck(request);
    }

    if (url.pathname === '/usage' && request.method === 'GET') {
      return this.handleGetUsage(request);
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Handles rate limit check and increment.
   */
  private async handleCheck(request: Request): Promise<Response> {
    const body = await request.json() as CheckRequest;
    const { keyId, plan, dailyLimit, minuteLimit } = body;

    // Get current time keys
    const currentDayKey = getUtcDayKey();
    const currentMinuteKey = getUtcMinuteKey();

    // Load current state
    let rateLimitState = await this.state.storage.get<RateLimitState>('state');

    // Initialize or reset state if needed
    if (!rateLimitState) {
      rateLimitState = {
        dayKey: currentDayKey,
        dayCount: 0,
        minuteKey: currentMinuteKey,
        minuteCount: 0,
      };
    }

    // Reset daily counter if day changed
    if (rateLimitState.dayKey !== currentDayKey) {
      rateLimitState.dayKey = currentDayKey;
      rateLimitState.dayCount = 0;
    }

    // Reset minute counter if minute changed
    if (rateLimitState.minuteKey !== currentMinuteKey) {
      rateLimitState.minuteKey = currentMinuteKey;
      rateLimitState.minuteCount = 0;
    }

    // Build usage state (before increment)
    const usage: UsageState = {
      keyId,
      plan,
      requestsToday: rateLimitState.dayCount,
      dailyLimit,
      minuteWindowCount: rateLimitState.minuteCount,
      minuteWindowLimit: minuteLimit,
    };

    // Check daily limit
    if (rateLimitState.dayCount >= dailyLimit) {
      const result: RateLimitResult = {
        allowed: false,
        errorCode: 'DAILY_LIMIT_EXCEEDED',
        message: 'Daily rate limit exceeded. Please try again tomorrow.',
        retryAfterSeconds: secondsUntilMidnightUtc(),
        usage,
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check minute limit
    if (rateLimitState.minuteCount >= minuteLimit) {
      const result: RateLimitResult = {
        allowed: false,
        errorCode: 'MINUTE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down.',
        retryAfterSeconds: secondsUntilNextMinute(),
        usage,
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Increment counters
    rateLimitState.dayCount++;
    rateLimitState.minuteCount++;

    // Save state
    await this.state.storage.put('state', rateLimitState);

    // Build updated usage (after increment)
    const updatedUsage: UsageState = {
      keyId,
      plan,
      requestsToday: rateLimitState.dayCount,
      dailyLimit,
      minuteWindowCount: rateLimitState.minuteCount,
      minuteWindowLimit: minuteLimit,
    };

    const result: RateLimitResult = {
      allowed: true,
      usage: updatedUsage,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handles usage query (for debugging/monitoring).
   */
  private async handleGetUsage(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const keyId = url.searchParams.get('keyId') || 'unknown';
    const plan = (url.searchParams.get('plan') || 'free') as Plan;
    const dailyLimit = parseInt(url.searchParams.get('dailyLimit') || '20', 10);
    const minuteLimit = parseInt(url.searchParams.get('minuteLimit') || '2', 10);

    const currentDayKey = getUtcDayKey();
    const currentMinuteKey = getUtcMinuteKey();

    let rateLimitState = await this.state.storage.get<RateLimitState>('state');

    // Initialize if needed
    if (!rateLimitState) {
      rateLimitState = {
        dayKey: currentDayKey,
        dayCount: 0,
        minuteKey: currentMinuteKey,
        minuteCount: 0,
      };
    }

    // Apply time window resets
    let dayCount = rateLimitState.dayCount;
    let minuteCount = rateLimitState.minuteCount;

    if (rateLimitState.dayKey !== currentDayKey) {
      dayCount = 0;
    }

    if (rateLimitState.minuteKey !== currentMinuteKey) {
      minuteCount = 0;
    }

    const usage: UsageState = {
      keyId,
      plan,
      requestsToday: dayCount,
      dailyLimit,
      minuteWindowCount: minuteCount,
      minuteWindowLimit: minuteLimit,
    };

    return new Response(JSON.stringify(usage), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
