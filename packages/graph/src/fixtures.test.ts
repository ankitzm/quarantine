import { describe, expect, it } from 'vitest';
import { loadFixture, readFixtures } from './fixtures.ts';
import { graphHash } from './inspect.ts';
import { assertReady } from './schema.ts';
import { scratchGraph } from './testing.ts';

const graph = scratchGraph();

describe('fixtures', () => {
  it('replays every committed fixture to the same graph twice', async () => {
    for (const fixture of await readFixtures('fixtures/runs')) {
      await loadFixture(graph, fixture);
      const first = await graphHash(graph);
      await loadFixture(graph, fixture);
      expect(await graphHash(graph), fixture.run).toBe(first);
      await expect(assertReady(graph)).resolves.toBeUndefined();
    }
  });
});
