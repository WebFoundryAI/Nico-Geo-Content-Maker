/**
 * Cloudflare Worker - GEO Execution Adapter
 *
 * Exposes the GEO content generation engine via HTTP.
 * This is a thin adapter that routes requests to the existing GEO system.
 */

import { runGEOPipeline } from '../core/pipeline/geoPipeline';
import type { BusinessInput } from '../inputs/business.schema';

export interface Env {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // GET /health - Health check
    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /run - Execute GEO pipeline
    if (url.pathname === '/run' && request.method === 'POST') {
      try {
        const input = await request.json() as BusinessInput;
        const result = runGEOPipeline(input);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return new Response(
          JSON.stringify({ status: 'error', message }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // 404 for all other routes
    return new Response(
      JSON.stringify({ status: 'error', message: 'Not found' }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  },
};
