import { buildTimeline } from '@quarantine/graph';
import { graphFor, handle, Id } from '@/lib/http';

export async function GET(req: Request, ctx: RouteContext<'/api/incidents/[seed]/timeline'>) {
  return handle(async () => buildTimeline(await graphFor(req), { seed: Id.parse((await ctx.params).seed) }));
}
