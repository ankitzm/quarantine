import { memorySearch, memoryVersions, type VersionRow } from '../queries/views.ts';
import { run } from '../run.ts';
import { assertReady } from '../schema.ts';
import type { MemoryResponse } from '../types/api.ts';

/** Memory grouped by (ns, key) with every version, optionally narrowed by a full-text query. */
export async function buildMemory(graph: string, { q }: { q: string | null }): Promise<MemoryResponse> {
  const tenant = await assertReady(graph);
  const rows = q ? await run(graph, memorySearch, { q }) : await run(graph, memoryVersions);
  const keys = new Map<string, MemoryResponse['keys'][number]>();
  for (const r of rows) {
    const k = `${r.ns}\u0000${r.key}`;
    const entry = keys.get(k) ?? { ns: r.ns, key: r.key, kind: r.kind, versions: [] };
    entry.versions.push(version(r));
    keys.set(k, entry);
  }
  return { tenant, query: q, keys: [...keys.values()] };
}

const version = (r: VersionRow): MemoryResponse['keys'][number]['versions'][number] => ({
  id: r.id,
  text: r.text,
  validFrom: r.validFrom,
  validTo: r.validTo,
  isInvalidated: r.invalidated,
  writer: { episode: r.episode, agent: r.agent },
  supersedes: r.supersedes,
});
