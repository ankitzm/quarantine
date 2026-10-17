import { buildIncident } from '@quarantine/graph';
import { z } from 'zod';
import { graphFor, handle, Id, query } from '@/lib/http';

const Mode = z.enum(['temporal', 'naive']).default('temporal');

export async function GET(req: Request, ctx: RouteContext<'/api/incidents/[seed]'>) {
  return handle(async () =>
    buildIncident(graphFor(req), {
      seed: Id.parse((await ctx.params).seed),
      mode: Mode.parse(query(req).get('mode') ?? undefined),
    }),
  );
}
