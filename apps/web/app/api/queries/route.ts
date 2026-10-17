import { buildQueryLog } from '@quarantine/graph';
import { z } from 'zod';
import { handle, query } from '@/lib/http';

export const dynamic = 'force-dynamic';

const Limit = z.coerce.number().int().min(1).max(200).default(50);

export async function GET(req: Request) {
  return handle(async () => buildQueryLog({ limit: Limit.parse(query(req).get('limit') ?? undefined) }));
}
