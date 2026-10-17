import { randomUUID } from 'node:crypto';
import { api, getDb, loadFixture, readConfigEvents, readFixture } from '@quarantine/graph';
import { scratchGraph } from '@quarantine/graph/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Route handlers read the sid cookie through next/headers; give them a plain in-memory jar.
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

const { GET: health } = await import('./health/route');
const { GET: incident } = await import('./incidents/[seed]/route');
const { POST: createPlan } = await import('./incidents/[seed]/plans/route');
const { POST: apply } = await import('./plans/[id]/apply/route');
const { GET: memory } = await import('./memory/route');
const { POST: reset } = await import('./demo/reset/route');
const { POST: scan } = await import('./scan/route');
const { POST: mcp } = await import('./mcp/route');

const tenant = `t${randomUUID().slice(0, 6)}`;
scratchGraph(`tenant_${tenant}`);
const SEED = 'acme-mem-sop-v4';
const url = (path: string) => `http://test${path}${path.includes('?') ? '&' : '?'}tenant=${tenant}`;
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });

beforeAll(async () => {
  const fixture = await readFixture('fixtures/runs/acme-attack1.seed.json');
  await loadFixture(`tenant_${tenant}`, fixture, await readConfigEvents('fixtures/configs/acme', 'acme', 0));
});
afterAll(async () => {
  const db = await getDb();
  for (const g of await db.list()) if (g.startsWith(`demo_${tenant}_`)) await db.selectGraph(g).delete();
});

describe('API routes', () => {
  it('reports health', async () => {
    const { status, body } = await json(await health());
    expect(status).toBe(200);
    api.HealthResponse.parse(body);
  });

  it('traces an incident on the visitor copy and issues a sid', async () => {
    const { status, body } = await json(
      await incident(new Request(url(`/api/incidents/${SEED}?mode=naive`)), params({ seed: SEED })),
    );
    expect(status).toBe(200);
    expect(api.IncidentResponse.parse(body).naiveFalsePositives.episodes).toEqual(['acme-analytics-1']);
    expect(jar.get('sid')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('maps errors onto the contract', async () => {
    const missing = await json(
      await incident(new Request(url('/api/incidents/nope')), params({ seed: 'nope' })),
    );
    expect(missing).toEqual({
      status: 404,
      body: { error: { code: 'SEED_NOT_FOUND', message: expect.any(String) } },
    });
    const bad = await json(
      await incident(new Request(url(`/api/incidents/${SEED}?mode=x`)), params({ seed: SEED })),
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('plans, refuses apply without confirm, applies, and resets', async () => {
    const plan = api.PlanResponse.parse(
      (
        await json(
          await createPlan(
            new Request(url(`/api/incidents/${SEED}/plans`), { method: 'POST' }),
            params({ seed: SEED }),
          ),
        )
      ).body,
    );
    const post = (body?: unknown) =>
      apply(
        new Request(url(`/api/plans/${plan.id}/apply`), {
          method: 'POST',
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        params({ id: plan.id }),
      );
    expect((await json(await post())).body.error.code).toBe('CONFIRM_REQUIRED');
    const applied = await json(await post({ confirm: true }));
    expect(api.ApplyResponse.parse(applied.body).reachAfter).toEqual([]);

    const mem = api.MemoryResponse.parse(
      (await json(await memory(new Request(url('/api/memory?q=refunds'))))).body,
    );
    expect(mem.keys.find((k) => k.key === 'refunds')?.versions).toHaveLength(3);

    expect((await reset(new Request(url('/api/demo/reset'), { method: 'POST' }))).status).toBe(200);
    const after = api.MemoryResponse.parse(
      (await json(await memory(new Request(url('/api/memory?q=refunds'))))).body,
    );
    expect(after.keys.find((k) => k.key === 'refunds')?.versions).toHaveLength(2);
  });

  it('caps and rate-limits scans', async () => {
    const big = new Request('http://test/api/scan', {
      method: 'POST',
      headers: { 'x-forwarded-for': '1.1.1.1' },
      body: 'x'.repeat(70_000),
    });
    expect((await scan(big)).status).toBe(413);
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const req = new Request('http://test/api/scan', {
        method: 'POST',
        headers: { 'x-forwarded-for': '2.2.2.2' },
        body: '{}',
      });
      statuses.push((await scan(req)).status);
    }
    expect(statuses).toEqual([422, 422, 422, 422, 422, 429]);
  });

  it('serves MCP over HTTP', async () => {
    const res = await mcp(
      new Request(url('/api/mcp'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 't', version: '0' },
          },
        }),
      }),
    );
    expect((await res.json()).result.serverInfo.name).toBe('quarantine');
  });
});
