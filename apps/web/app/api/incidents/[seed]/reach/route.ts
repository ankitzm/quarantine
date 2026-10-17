import { buildReach } from '@quarantine/graph';
import { graphFor, handle, Id } from '@/lib/http';

export async function GET(req: Request, ctx: RouteContext<'/api/incidents/[seed]/reach'>) {
  return handle(async () => buildReach(await graphFor(req), { seed: Id.parse((await ctx.params).seed) }));
}
