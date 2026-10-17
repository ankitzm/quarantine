import { getDb } from './client.ts';
import { GraphNotReady } from './errors.ts';
import { copiedAt, stampCopy } from './queries/demo.ts';
import { run } from './run.ts';
import { assertReady } from './schema.ts';

export const DEMO_TTL_MS = 2 * 60 * 60 * 1000;
const PREFIX = 'demo_';

export const demoGraph = (tenant: string, sid: string) => `${PREFIX}${tenant}_${sid}`;

/**
 * The visitor's private copy of a tenant graph, made with GRAPH.COPY on first use. Visitors plan and apply
 * against their copy, so base tenant graphs are never mutated by the public demo.
 */
export async function ensureDemoGraph(
  tenant: string,
  sid: string,
  { reset = false, now = Date.now() } = {},
): Promise<string> {
  const base = `tenant_${tenant}`;
  const graph = demoGraph(tenant, sid);
  const db = await getDb();
  const exists = (await db.list()).includes(graph);
  if (exists && !reset) return graph;
  await assertReady(base);
  if (exists) await db.selectGraph(graph).delete();
  else await sweepDemoGraphs(now);
  try {
    await db.selectGraph(base).copy(graph);
  } catch (e) {
    // A concurrent first request made the copy already.
    if (!(e instanceof Error && /already exists/.test(e.message))) throw e;
    return graph;
  }
  await run(graph, stampCopy, { now });
  return graph;
}

/** Deletes visitor copies older than the TTL. Returns how many were removed. */
export async function sweepDemoGraphs(now = Date.now(), ttlMs = DEMO_TTL_MS): Promise<number> {
  const db = await getDb();
  let removed = 0;
  for (const graph of (await db.list()).filter((g) => g.startsWith(PREFIX))) {
    const [row] = await run(graph, copiedAt).catch((e: unknown) => {
      if (e instanceof GraphNotReady) return [];
      throw e;
    });
    if (now - (row?.at ?? 0) > ttlMs) {
      await db
        .selectGraph(graph)
        .delete()
        .catch(() => undefined);
      removed++;
    }
  }
  return removed;
}
