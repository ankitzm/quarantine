import { applyQuarantine, getPlan, planQuarantine } from '../permissions/plan.ts';
import * as q from '../queries/permissions.ts';
import { run } from '../run.ts';
import { assertReady } from '../schema.ts';
import type { ApplyResponse, PlanResponse } from '../types/api.ts';

/** Once a seed is contained, return the plan that contained it: re-planning the cut graph yields an empty plan. */
export async function buildCreatePlan(graph: string, { seed }: { seed: string }): Promise<PlanResponse> {
  const tenant = await assertReady(graph);
  const [applied] = await run(graph, q.appliedPlanFor, { seed });
  const id = applied?.id ?? (await planQuarantine(graph, seed)).id;
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
