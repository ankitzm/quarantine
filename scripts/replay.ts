// Load every fixture in fixtures/runs into a fresh tenant graph.
// Usage: pnpm replay [--if-missing]   (--if-missing skips tenants whose graph finished loading)
import {
  assertReady,
  closeDb,
  graphHash,
  loadFixture,
  readConfigEvents,
  readFixtures,
  tenantGraph,
} from '@quarantine/graph';

const ifMissing = process.argv.includes('--if-missing');
const loaded = (graph: string) =>
  assertReady(graph).then(
    () => true,
    () => false,
  );

for (const fixture of await readFixtures('fixtures/runs')) {
  const graph = tenantGraph(fixture.tenant);
  if (ifMissing && (await loaded(graph))) {
    console.log(`skip  ${graph} (ready)`);
    continue;
  }
  const started = performance.now();
  const t0 = fixture.events[0]?.t ?? 0;
  await loadFixture(
    graph,
    fixture,
    await readConfigEvents(`fixtures/configs/${fixture.tenant}`, fixture.tenant, t0),
  );
  const ms = Math.round(performance.now() - started);
  console.log(
    `load  ${graph}  ${fixture.run}  ${fixture.events.length} events  ${ms}ms  ${(await graphHash(graph)).slice(0, 12)}`,
  );
}
await closeDb();
