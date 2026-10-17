import { GraphNotReady } from './errors.ts';
import { idIndexes, markReady, memoryKeyIndex, memoryTextIndex, readMeta } from './queries/schema.ts';
import { run } from './run.ts';

/** Creates every index. Safe to call repeatedly: an index that already exists is skipped. */
export async function ensureSchema(graph: string): Promise<void> {
  for (const q of [...idIndexes, memoryKeyIndex, memoryTextIndex]) {
    await run(graph, q).catch((e: unknown) => {
      if (!(e instanceof Error && /already indexed/.test(e.message))) throw e;
    });
  }
}

export async function markGraphReady(graph: string, tenant: string, now = Date.now()): Promise<void> {
  await run(graph, markReady, { tenant, now });
}

/** Throws {@link GraphNotReady} unless the graph exists and its load finished. */
export async function assertReady(graph: string): Promise<void> {
  const [meta] = await run(graph, readMeta);
  if (!meta?.ready) throw new GraphNotReady(graph);
}
