import { describe, expect, it } from 'vitest';
import { GraphNotReady } from './errors.ts';
import { assertReady, ensureSchema, markGraphReady } from './schema.ts';
import { scratchGraph } from './testing.ts';

const graph = scratchGraph();

describe('schema', () => {
  it('refuses graphs that were never loaded', async () => {
    await expect(assertReady(graph)).rejects.toBeInstanceOf(GraphNotReady);
  });

  it('is idempotent and refuses until marked ready', async () => {
    await ensureSchema(graph);
    await ensureSchema(graph);
    await expect(assertReady(graph)).rejects.toBeInstanceOf(GraphNotReady);
    await markGraphReady(graph, 'acme');
    await expect(assertReady(graph)).resolves.toBeUndefined();
  });
});
