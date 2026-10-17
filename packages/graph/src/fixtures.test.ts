import { describe, expect, it } from 'vitest';
import { loadFixture, readConfigEvents, readFixtures } from './fixtures.ts';
import { graphHash } from './inspect.ts';
import { assertReady } from './schema.ts';
import { scratchGraph } from './testing.ts';

const graph = scratchGraph();

describe('fixtures', () => {
  it('replays every committed fixture to the same graph twice', async () => {
    for (const fixture of await readFixtures('fixtures/runs')) {
      const configs = await readConfigEvents(`fixtures/configs/${fixture.tenant}`, fixture.tenant, 0);
      expect(configs.length, fixture.tenant).toBeGreaterThan(0);
      await loadFixture(graph, fixture, configs);
      const first = await graphHash(graph);
      await loadFixture(graph, fixture, configs);
      expect(await graphHash(graph), fixture.run).toBe(first);
      await expect(assertReady(graph)).resolves.toBe(fixture.tenant);
    }
  });
});
