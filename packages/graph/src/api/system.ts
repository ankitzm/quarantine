import { getDb } from '../client.ts';
import { readMeta } from '../queries/schema.ts';
import { queryLog, run } from '../run.ts';
import type { EvalResponse, HealthResponse, QueryLogResponse } from '../types/api.ts';

const TENANT_PREFIX = 'tenant_';

/** ok: engine up and every tenant graph loaded. degraded: up, but a tenant is missing or loading. */
export async function buildHealth(): Promise<HealthResponse> {
  const started = performance.now();
  const latencyMs = () => Math.round(performance.now() - started);
  try {
    const graphs = (await (await getDb()).list()).filter((g) => g.startsWith(TENANT_PREFIX)).sort();
    const tenants = await Promise.all(
      graphs.map(async (g) => ({
        tenant: g.slice(TENANT_PREFIX.length),
        isReady: (await run(g, readMeta))[0]?.ready ?? false,
      })),
    );
    const ok = tenants.length > 0 && tenants.every((t) => t.isReady);
    return { status: ok ? 'ok' : 'degraded', engine: { reachable: true }, tenants, latencyMs: latencyMs() };
  } catch {
    return { status: 'down', engine: { reachable: false }, tenants: [], latencyMs: latencyMs() };
  }
}

export function buildQueryLog({ limit }: { limit: number }): QueryLogResponse {
  return { entries: queryLog(limit) };
}

/** Latest `pnpm eval` output (eval/results/latest.json), or pending until it has run. */
export function buildEval(results: unknown): EvalResponse {
  if (!results || typeof results !== 'object') return { status: 'pending', generatedAt: null, results: null };
  const generatedAt = (results as { generatedAt?: unknown }).generatedAt;
  return { status: 'complete', generatedAt: typeof generatedAt === 'number' ? generatedAt : null, results };
}
