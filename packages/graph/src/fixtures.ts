import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { getDb } from './client.ts';
import { Event } from './events.ts';
import { applyEvents } from './ingest.ts';
import { ensureSchema, markGraphReady } from './schema.ts';

export const Fixture = z.object({
  tenant: z.string().regex(/^[a-z0-9-]+$/),
  run: z.string(),
  description: z.string(),
  /** The poisoned memory version and the clean version quarantine restores. Null for clean tenants. */
  incident: z.object({ seed: z.string(), restore: z.string() }).nullable(),
  events: z.array(Event),
});
export type Fixture = z.infer<typeof Fixture>;

export const tenantGraph = (tenant: string) => `tenant_${tenant}`;

export async function readFixture(path: string): Promise<Fixture> {
  return Fixture.parse(JSON.parse(await readFile(path, 'utf8')));
}

/** Every top-level fixture in `dir`, one per tenant. */
export async function readFixtures(dir: string): Promise<Fixture[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const fixtures = await Promise.all(files.map((f) => readFixture(join(dir, f))));
  const tenants = fixtures.map((f) => f.tenant);
  const dup = tenants.find((t, i) => tenants.indexOf(t) !== i);
  if (dup) throw new Error(`two fixtures for tenant "${dup}" in ${dir}`);
  return fixtures;
}

/** Rebuilds `graph` from scratch: drop, schema, events, then the ready flag last. */
export async function loadFixture(graph: string, fixture: Fixture): Promise<void> {
  const db = await getDb();
  if ((await db.list()).includes(graph)) await db.selectGraph(graph).delete();
  await ensureSchema(graph);
  await applyEvents(graph, fixture.events);
  await markGraphReady(graph, fixture.tenant);
}
