import { buildCreatePlan } from '@quarantine/graph';
import { graphFor, handle, Id } from '@/lib/http';

/** Deterministic for a given graph state, so retrying returns the same plan. */
export async function POST(req: Request, ctx: RouteContext<'/api/incidents/[seed]/plans'>) {
  return handle(async () => buildCreatePlan(graphFor(req), { seed: Id.parse((await ctx.params).seed) }));
}
