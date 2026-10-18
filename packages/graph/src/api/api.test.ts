import { beforeAll, describe, expect, it } from 'vitest';
import { GraphNotReady, SeedNotFound } from '../errors.ts';
import { loadFixture, readConfigEvents, readFixture } from '../fixtures.ts';
import { scratchGraph } from '../testing.ts';
import * as contract from '../types/api.ts';
import {
  buildApply,
  buildCreatePlan,
  buildIncident,
  buildMemory,
  buildPlan,
  buildReach,
  buildTimeline,
} from './index.ts';

const graph = scratchGraph();
const seed = 'acme-mem-sop-v4';

beforeAll(async () => {
  const fixture = await readFixture('fixtures/runs/acme-attack1.seed.json');
  await loadFixture(graph, fixture, await readConfigEvents('fixtures/configs/acme', 'acme', 0));
});

describe('response builders', () => {
  it('produce payloads that satisfy the contract', async () => {
    contract.IncidentResponse.parse(await buildIncident(graph, { seed, mode: 'temporal' }));
    contract.TimelineResponse.parse(await buildTimeline(graph, { seed }));
    contract.ReachResponse.parse(await buildReach(graph, { seed }));
    contract.MemoryResponse.parse(await buildMemory(graph, { q: 'escrow OR refunds' }));
    const plan = contract.PlanResponse.parse(await buildCreatePlan(graph, { seed }));
    contract.PlanResponse.parse(await buildPlan(graph, { id: plan.id }));
    const applied = contract.ApplyResponse.parse(await buildApply(graph, { id: plan.id, confirm: true }));
    expect(applied.reachAfter).toEqual([]);
    expect((await buildPlan(graph, { id: plan.id })).appliedAt).not.toBeNull();
    // A reload after apply must see the plan that contained the incident, not an empty re-plan.
    const again = await buildCreatePlan(graph, { seed });
    expect(again.id).toBe(plan.id);
    expect(again.cut).toHaveLength(plan.cut.length);
  });

  it('report naive false positives', async () => {
    const { tenant, naiveFalsePositives } = await buildIncident(graph, { seed, mode: 'naive' });
    expect(tenant).toBe('acme');
    expect(naiveFalsePositives.episodes).toEqual(['acme-analytics-1']);
  });

  it('refuse unloaded graphs and unknown seeds with typed errors', async () => {
    await expect(buildReach(`${graph}_missing`, { seed })).rejects.toBeInstanceOf(GraphNotReady);
    await expect(buildIncident(graph, { seed: 'nope', mode: 'temporal' })).rejects.toBeInstanceOf(
      SeedNotFound,
    );
  });
});
