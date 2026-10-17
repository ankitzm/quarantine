// Regenerate apps/web/mocks/*.json from the real builders against a scratch copy of the acme fixture.
// Every payload is validated against the API contract before it is written.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  api,
  buildApply,
  buildCreatePlan,
  buildEval,
  buildHealth,
  buildIncident,
  buildMemory,
  buildQueryLog,
  buildReach,
  buildScan,
  buildTimeline,
  closeDb,
  getDb,
  loadFixture,
  queryEvents,
  readConfigEvents,
  readFixture,
  type QueryLogEntry,
} from '@quarantine/graph';

const OUT = 'apps/web/mocks';
const graph = 'mocks_acme';
const fixture = await readFixture('fixtures/runs/acme-attack1.seed.json');
const seed = fixture.incident?.seed;
if (!seed) throw new Error('acme fixture has no incident');

await loadFixture(graph, fixture, await readConfigEvents('fixtures/configs/acme', 'acme', 0));
await mkdir(OUT, { recursive: true });

async function write(name: string, schema: { parse(v: unknown): unknown }, payload: unknown): Promise<void> {
  const parsed = schema.parse(payload);
  await writeFile(`${OUT}/${name}.json`, `${JSON.stringify(parsed, null, 2)}\n`);
  console.log(`wrote ${name}.json`);
}

const stream: QueryLogEntry[] = [];
queryEvents.on('query', (e) => stream.length < 40 && stream.push(e));

await write('health', api.HealthResponse, await buildHealth());
await write(
  'incident.temporal',
  api.IncidentResponse,
  await buildIncident(graph, { seed, mode: 'temporal' }),
);
const rounds: unknown[] = [];
const streamed = await buildIncident(graph, {
  seed,
  mode: 'temporal',
  onRound: (r) => rounds.push({ type: 'round', ...r }),
});
await write('sse.trace', api.TraceStreamEvent.array(), [...rounds, { type: 'done', incident: streamed }]);
await write('incident.naive', api.IncidentResponse, await buildIncident(graph, { seed, mode: 'naive' }));
await write('timeline', api.TimelineResponse, await buildTimeline(graph, { seed }));
await write('reach', api.ReachResponse, await buildReach(graph, { seed }));
await write('memory', api.MemoryResponse, await buildMemory(graph, { q: null }));
await write('memory.search', api.MemoryResponse, await buildMemory(graph, { q: 'refunds' }));
const plan = await buildCreatePlan(graph, { seed });
await write('plan', api.PlanResponse, plan);
await write(
  'apply',
  api.ApplyResponse,
  await buildApply(graph, { id: plan.id, confirm: true, now: 1_792_400_000_000 }),
);
await write('reach.after', api.ReachResponse, await buildReach(graph, { seed }));
await write('memory.after', api.MemoryResponse, await buildMemory(graph, { q: null }));
await write('queries', api.QueryLogResponse, buildQueryLog({ limit: 50 }));
await write(
  'eval',
  api.EvalResponse,
  buildEval(JSON.parse(await readFile('eval/results/latest.json', 'utf8'))),
);
const config = async (agent: string) =>
  JSON.parse(await readFile(`fixtures/configs/acme/${agent}.mcp.json`, 'utf8'));
await write(
  'scan',
  api.ScanResponse,
  await buildScan({
    configs: { billing: await config('billing'), ops: await config('ops') },
    compromised: ['billing'],
  }),
);
await write('demo.reset', api.DemoResetResponse, { tenant: 'acme', resetAt: 1_792_400_000_000 });
await write('error.confirm-required', api.ErrorResponse, {
  error: { code: 'CONFIRM_REQUIRED', message: 'applying a quarantine requires confirm=true' },
});
// SSE streams, as the ordered list of `data:` payloads a client would receive.
await write('sse.queries', api.QueryLogEntry.array(), stream);

await (await getDb()).selectGraph(graph).delete();
await closeDb();
