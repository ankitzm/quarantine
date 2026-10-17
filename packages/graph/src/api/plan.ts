import { applyQuarantine, getPlan, planQuarantine } from '../permissions/plan.ts';
import { assertReady } from '../schema.ts';
import type { ApplyResponse, PlanResponse } from '../types/api.ts';

export async function buildCreatePlan(graph: string, { seed }: { seed: string }): Promise<PlanResponse> {
  const tenant = await assertReady(graph);
  const { id } = await planQuarantine(graph, seed);
  return { tenant, ...(await getPlan(graph, id)) };
}

export async function buildPlan(graph: string, { id }: { id: string }): Promise<PlanResponse> {
  const tenant = await assertReady(graph);
  return { tenant, ...(await getPlan(graph, id)) };
}

export async function buildApply(
  graph: string,
  { id, confirm, now }: { id: string; confirm: boolean; now?: number },
): Promise<ApplyResponse> {
  const tenant = await assertReady(graph);
  return {
    tenant,
    ...(await applyQuarantine(graph, id, { confirm, ...(now === undefined ? {} : { now }) })),
  };
}
