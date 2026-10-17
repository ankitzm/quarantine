import { buildMemory } from '@quarantine/graph';
import { z } from 'zod';
import { graphFor, handle, query } from '@/lib/http';

const Q = z.string().trim().max(200).nullable();

export async function GET(req: Request) {
  return handle(async () => buildMemory(graphFor(req), { q: Q.parse(query(req).get('q')) || null }));
}
