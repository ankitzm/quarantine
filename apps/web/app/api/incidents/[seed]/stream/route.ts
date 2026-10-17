import { buildIncident, QuarantineError } from '@quarantine/graph';
import { z } from 'zod';
import { graphFor, handle, Id, query } from '@/lib/http';
import { sse } from '@/lib/sse';

export const dynamic = 'force-dynamic';

const Mode = z.enum(['temporal', 'naive']).default('temporal');

/** The trace as it runs: one event per relaxation round, then the full incident. */
export async function GET(req: Request, ctx: RouteContext<'/api/incidents/[seed]/stream'>) {
  let input: { graph: string; seed: string; mode: 'temporal' | 'naive' };
  try {
    input = {
      graph: await graphFor(req),
      seed: Id.parse((await ctx.params).seed),
      mode: Mode.parse(query(req).get('mode') ?? undefined),
    };
  } catch (e) {
    return handle(() => Promise.reject(e));
  }
  return sse(req, async (send, close) => {
    try {
      const incident = await buildIncident(input.graph, {
        seed: input.seed,
        mode: input.mode,
        onRound: (r) => send({ type: 'round', ...r }),
      });
      send({ type: 'done', incident });
    } catch (e) {
      const error =
        e instanceof QuarantineError
          ? { code: e.code, message: e.message }
          : { code: 'INTERNAL', message: 'internal error' };
      send({ type: 'error', error });
    }
    close();
  });
}
