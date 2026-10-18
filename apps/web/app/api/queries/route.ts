import { buildQueryLog } from '@quarantine/graph';
import { z } from 'zod';
import { graphFor, handle, query } from '@/lib/http';

export const dynamic = 'force-dynamic';

const Limit = z.coerce.number().int().min(1).max(200).default(50);

export async function GET(req: Request) {
  // Scoped to the caller's own demo graph: other visitors' queries are not theirs to see.
  return handle(async () =>
    buildQueryLog({ limit: Limit.parse(query(req).get('limit') ?? undefined), graph: await graphFor(req) }),
  );
}
