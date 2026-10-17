import { beforeAll, describe, expect, it } from 'vitest';
import type { EventInput } from './events.ts';
import { applyEvents } from './ingest.ts';
import { defineQuery } from './queries/types.ts';
import { run } from './run.ts';
import { ensureSchema } from './schema.ts';
import { FalkorDBStore } from './store.ts';
import { scratchGraph } from './testing.ts';

const graph = scratchGraph();
let clock = 1_000;
const events: EventInput[] = [];
const base = new FalkorDBStore(graph, { now: () => (clock += 10), onEvent: (e) => events.push(e) });
const researcher = base.as({ episodeId: 'ep-r', inputIds: ['in-page'] });
const billing = base.as({ episodeId: 'ep-b' });

const versions = defineQuery<{ id: string; validTo: number | null; supersedes: string | null }>({
  name: 'test.versions',
  description: 'versions of sop/refunds',
  mode: 'read',
  cypher: `MATCH (m:MemoryItem {ns: 'sop', key: 'refunds'}) OPTIONAL MATCH (m)-[:SUPERSEDES]->(p)
           RETURN m.id AS id, m.valid_to AS validTo, p.id AS supersedes ORDER BY m.valid_from`,
});
const reads = defineQuery<{ n: number }>({
  name: 'test.reads',
  description: 'reads by billing',
  mode: 'read',
  cypher: `MATCH (:Episode {id: 'ep-b'})-[r:READ]->() RETURN count(r) AS n`,
});

beforeAll(async () => {
  await ensureSchema(graph);
  await applyEvents(graph, [
    { type: 'Session', id: 's', t: 0, tenant: 't' },
    { type: 'Episode', id: 'ep-r', t: 1, session: 's', agent: 'researcher' },
    { type: 'Episode', id: 'ep-b', t: 2, session: 's', agent: 'billing' },
    { type: 'Input', id: 'in-page', t: 3, episode: 'ep-r', source: 'web', text: 'page' },
  ]);
});

describe('FalkorDBStore', () => {
  it('versions puts instead of overwriting and serves the current one', async () => {
    await researcher.put(['sop'], 'refunds', { text: 'v1 needs approval' });
    await researcher.put(['sop'], 'refunds', { text: 'v2 no approval', priority: 1 });
    const item = await billing.get(['sop'], 'refunds');
    expect(item?.value).toEqual({ text: 'v2 no approval', priority: 1 });
    expect(item?.namespace).toEqual(['sop']);
    expect(item?.createdAt.getTime()).toBeLessThan(item?.updatedAt.getTime() ?? 0);

    const rows = await run(graph, versions);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.validTo).not.toBeNull();
    expect(rows[1]).toMatchObject({ validTo: null, supersedes: rows[0]?.id });
  });

  it('records attributed reads and provenance as events', async () => {
    expect(await run(graph, reads)).toEqual([{ n: 1 }]);
    const writes = events.filter((e) => e.type === 'MemoryWrite');
    expect(writes.map((e) => e.type === 'MemoryWrite' && e.derivedFrom)).toEqual([['in-page'], ['in-page']]);
    expect(events.some((e) => e.type === 'MemoryRead' && e.episode === 'ep-b')).toBe(true);
  });

  it('searches current versions by text, prefix and filter', async () => {
    await researcher.put(['customer', 'acme'], 'c-1', { text: 'prefers wire refunds', tier: 'gold' });
    await researcher.put(['customer', 'acme'], 'c-2', { text: 'card refunds only', tier: 'silver' });
    const hits = await billing.search(['customer'], { query: 'refunds' });
    expect(hits.map((h) => h.key).sort()).toEqual(['c-1', 'c-2']);
    expect(hits.every((h) => typeof h.score === 'number')).toBe(true);
    expect((await billing.search(['customer'], { filter: { tier: 'gold' } })).map((h) => h.key)).toEqual([
      'c-1',
    ]);
    expect((await billing.search(['sop'], { query: 'approval' })).map((h) => h.value.text)).toEqual([
      'v2 no approval',
    ]);
  });

  it('lists namespaces with match conditions and depth', async () => {
    expect(await base.listNamespaces()).toEqual([['customer', 'acme'], ['sop']]);
    expect(await base.listNamespaces({ prefix: ['customer'] })).toEqual([['customer', 'acme']]);
    expect(await base.listNamespaces({ maxDepth: 1 })).toEqual([['customer'], ['sop']]);
  });

  it('deletes by closing the version and hides invalidated versions', async () => {
    await researcher.delete(['customer', 'acme'], 'c-2');
    expect(await billing.get(['customer', 'acme'], 'c-2')).toBeNull();
    await run(
      graph,
      defineQuery({
        name: 'test.invalidate',
        description: '',
        mode: 'write',
        cypher: "MATCH (m:MemoryItem {key: 'c-1'}) SET m.invalidated = true",
      }),
    );
    expect(await billing.get(['customer', 'acme'], 'c-1')).toBeNull();
  });

  it('refuses unattributed writes', async () => {
    await expect(base.put(['sop'], 'x', { text: 'y' })).rejects.toThrow(/actor/);
  });
});
