import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from './client.ts';
import { demoGraph, ensureDemoGraph, sweepDemoGraphs } from './demo.ts';
import { loadFixture, readConfigEvents, readFixture } from './fixtures.ts';
import { graphHash } from './inspect.ts';
import { applyQuarantine, planQuarantine } from './permissions/plan.ts';
import { scratchGraph } from './testing.ts';

// The base must be named tenant_<t>; a random tenant keeps parallel test files apart.
const tenant = `t${randomUUID().slice(0, 6)}`;
const base = scratchGraph(`tenant_${tenant}`);
const sid = randomUUID().slice(0, 8);

beforeAll(async () => {
  const fixture = await readFixture('fixtures/runs/acme-attack1.seed.json');
  await loadFixture(base, fixture, await readConfigEvents('fixtures/configs/acme', 'acme', 0));
});

describe('demo graphs', () => {
  it('copies the base per visitor and never mutates it', async () => {
    const before = await graphHash(base);
    const graph = await ensureDemoGraph(tenant, sid, { now: 1_000 });
    expect(graph).toBe(demoGraph(tenant, sid));
    expect(await ensureDemoGraph(tenant, sid)).toBe(graph);
    const plan = await planQuarantine(graph, 'acme-mem-sop-v4');
    await applyQuarantine(graph, plan.id, { confirm: true });
    expect(await graphHash(base)).toBe(before);

    const reset = await ensureDemoGraph(tenant, sid, { reset: true, now: 2_000 });
    expect(await graphHash(reset)).toBe(before);
  });

  it('sweeps copies past their TTL', async () => {
    const db = await getDb();
    expect(await sweepDemoGraphs(2_000 + 1_000, 5_000)).toBe(0);
    expect(await sweepDemoGraphs(2_000 + 10_000, 5_000)).toBeGreaterThanOrEqual(1);
    expect((await db.list()).includes(demoGraph(tenant, sid))).toBe(false);
  });
});
