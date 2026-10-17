import { beforeAll, describe, expect, it } from 'vitest';
import { ConfirmRequired, PlanNotFound } from '../errors.ts';
import { loadFixture, readConfigEvents, readFixture } from '../fixtures.ts';
import { graphHash } from '../inspect.ts';
import { network } from '../queries/permissions.ts';
import { defineQuery } from '../queries/types.ts';
import { run } from '../run.ts';
import { scratchGraph } from '../testing.ts';
import { SENSITIVE } from './manifests.ts';
import { exhaustiveMinCost } from './mincut.ts';
import { applyQuarantine, planQuarantine, reachOf } from './plan.ts';

const graph = scratchGraph();
const SEED = 'acme-mem-sop-v4';

const current = defineQuery<{ id: string; text: string; supersedes: string[] }>({
  name: 'test.currentRefundSop',
  description: 'current version of sop/refunds',
  mode: 'read',
  cypher: `MATCH (m:MemoryItem {ns: 'sop', key: 'refunds'}) WHERE m.valid_to IS NULL
           OPTIONAL MATCH (m)-[:SUPERSEDES]->(o)
           RETURN m.id AS id, m.text AS text, collect(o.id) AS supersedes`,
});
const sopText = defineQuery<{ text: string; invalidated: boolean }>({
  name: 'test.item',
  description: 'memory text',
  mode: 'read',
  cypher: 'MATCH (m:MemoryItem {id: $id}) RETURN m.text AS text, m.invalidated AS invalidated',
});

beforeAll(async () => {
  const fixture = await readFixture('fixtures/runs/acme-attack1.seed.json');
  await loadFixture(graph, fixture, await readConfigEvents('fixtures/configs/acme', 'acme', 0));
});

describe('planQuarantine', () => {
  it('finds a min cut equal to max flow and to the exhaustive optimum', async () => {
    const plan = await planQuarantine(graph, SEED);
    expect(plan.agents).toEqual(['analytics', 'billing', 'ops', 'researcher']);
    expect(plan.reach.length).toBeGreaterThan(0);
    expect(plan.totalCost).toBe(plan.maxFlow);
    const edges = await run(graph, network, { agents: plan.agents, minSensitivity: SENSITIVE });
    const sinks = new Set(edges.filter((e) => e.toKey.startsWith('Resource:')).map((e) => e.to));
    expect(exhaustiveMinCost(edges, sinks)).toBe(plan.totalCost);
    expect(plan.cut.every((c) => c.source)).toBe(true);
    expect(plan.cut.map((c) => c.label)).toContain('Rotate STRIPE_SECRET_KEY');
  });

  it('is deterministic', async () => {
    expect((await planQuarantine(graph, SEED)).id).toBe((await planQuarantine(graph, SEED)).id);
  });
});

describe('applyQuarantine', () => {
  it('requires confirm and a stored plan', async () => {
    const plan = await planQuarantine(graph, SEED);
    await expect(applyQuarantine(graph, plan.id, { confirm: false })).rejects.toBeInstanceOf(ConfirmRequired);
    await expect(applyQuarantine(graph, 'plan_nope', { confirm: true })).rejects.toBeInstanceOf(PlanNotFound);
  });

  it('drops reach to zero, restores the SOP, and is idempotent', async () => {
    const plan = await planQuarantine(graph, SEED);
    const result = await applyQuarantine(graph, plan.id, { confirm: true, now: 1_800_000_000_000 });
    expect(result.reachAfter).toEqual([]);
    expect(await reachOf(graph, plan.agents)).toEqual([]);

    const [restored] = await run(graph, current);
    const [real] = await run(graph, sopText, { id: 'acme-mem-sop-v3' });
    expect(restored).toEqual({ id: result.restored, text: real?.text, supersedes: [SEED] });
    expect((await run(graph, sopText, { id: SEED }))[0]?.invalidated).toBe(true);
    expect(plan.items).toEqual(['acme-mem-cust-981']);
    expect((await run(graph, sopText, { id: 'acme-mem-cust-981' }))[0]?.invalidated).toBe(true);

    const before = await graphHash(graph);
    await applyQuarantine(graph, plan.id, { confirm: true, now: 1_900_000_000_000 });
    expect(await graphHash(graph)).toBe(before);
  });
});
