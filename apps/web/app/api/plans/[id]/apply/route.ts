import { api, buildApply } from '@quarantine/graph';
import { graphFor, handle, Id } from '@/lib/http';

/** Idempotent: applying the same plan again changes nothing and returns the same result. */
export async function POST(req: Request, ctx: RouteContext<'/api/plans/[id]/apply'>) {
  return handle(async () => {
    const { confirm } = api.ApplyRequest.parse(await req.json().catch(() => ({})));
    return buildApply(graphFor(req), { id: Id.parse((await ctx.params).id), confirm });
  });
}
