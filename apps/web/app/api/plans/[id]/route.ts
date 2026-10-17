import { buildPlan } from '@quarantine/graph';
import { graphFor, handle, Id } from '@/lib/http';

export async function GET(req: Request, ctx: RouteContext<'/api/plans/[id]'>) {
  return handle(async () => buildPlan(graphFor(req), { id: Id.parse((await ctx.params).id) }));
}
