import { beforeAll, describe, expect, it } from 'vitest';
import { buildMemory } from './api/memory.ts';
import { loadFixture, readFixture } from './fixtures.ts';
import { fullTextQuery } from './fulltext.ts';
import { FalkorDBStore } from './store.ts';
import { scratchGraph } from './testing.ts';

const graph = scratchGraph();
const HOSTILE = ['") OR 1=1', '@text:{x}', '-refund*', '%%%', '~(a|b)', 'refund" | "x'];

beforeAll(async () => {
  await loadFixture(graph, await readFixture('fixtures/runs/acme-attack1.seed.json'));
});

describe('fullTextQuery', () => {
  it('keeps words and drops query syntax', () => {
    expect(fullTextQuery('audit-sync.example/collect')).toBe('audit sync example collect');
    expect(fullTextQuery('  ')).toBeNull();
    expect(fullTextQuery('%%%')).toBeNull();
  });

  it('makes hostile input safe for the memory API and the agent store', async () => {
    const store = new FalkorDBStore(graph);
    for (const q of HOSTILE) {
      await expect(buildMemory(graph, { q })).resolves.toMatchObject({ tenant: 'acme' });
      await expect(store.search(['sop'], { query: q })).resolves.toBeInstanceOf(Array);
    }
    const hits = await buildMemory(graph, { q: 'audit-sync.example' });
    expect(hits.keys.map((k) => k.key)).toEqual(['refunds']);
  });
});
