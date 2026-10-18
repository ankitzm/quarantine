// Run the Sentinel live against a scratch copy of the acme graph, or replay a recorded run.
// Usage: pnpm sentinel            live via OpenRouter (OPENROUTER_API_KEY, LLM_MODEL), writes the run file
//        pnpm sentinel --replay   re-executes the recorded tool calls and reports any drift
import { readFile, writeFile } from 'node:fs/promises';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { closeDb, getDb, loadFixture, readConfigEvents, readFixtures } from '@quarantine/graph';
import { createMcpServer } from '@quarantine/graph/mcp';
import { replaySentinel, runSentinel, type SentinelRun } from '@quarantine/swarm';
import { openRouterModel } from './llm.ts';

const FILE = 'fixtures/runs/live/sentinel.json';
const ALERT =
  'Alert from Stripe: Billing issued a $4,800 refund on ticket #4471 to a new card without manager approval, ' +
  'and Ops made an outbound POST to audit-sync.example. Investigate.';

// Resolve inputs before touching the database, so a missing recording or key leaves nothing behind.
const replay = process.argv.includes('--replay');
const recorded = replay
  ? ((await readFile(FILE, 'utf8').then(JSON.parse, () => {
      console.error(`No recording at ${FILE}; run pnpm sentinel first.`);
      process.exit(1);
    })) as SentinelRun)
  : null;
const llm = replay ? null : openRouterModel(0);
const fixture = (await readFixtures('fixtures/runs')).find((f) => f.tenant === 'acme');
if (!fixture) throw new Error('no acme fixture');

const graph = 'sentinel_acme';
const client = new Client({ name: 'sentinel', version: '0.1.0' });
try {
  await loadFixture(graph, fixture, await readConfigEvents('fixtures/configs/acme', 'acme', 0));
  const [server, transport] = InMemoryTransport.createLinkedPair();
  await createMcpServer(graph).connect(server);
  await client.connect(transport);

  if (recorded) {
    const drift = await replaySentinel(client, recorded);
    console.log(
      drift.length
        ? `drift in ${drift.map((d) => d.tool).join(', ')}`
        : `replayed ${recorded.calls.length} calls, no drift`,
    );
    process.exitCode = drift.length ? 1 : 0;
  } else if (llm) {
    const run = await runSentinel({ model: llm.model, client, alert: ALERT });
    const json = `${JSON.stringify({ model: llm.name, fixture: fixture.run, ...run }, null, 2)}\n`;
    if (json.includes(llm.apiKey)) throw new Error('API key in Sentinel output');
    await writeFile(FILE, json);
    console.log(run.calls.map((c) => c.tool).join(' -> '));
    console.log(run.narrative);
  }
} finally {
  await client.close().catch(() => undefined);
  const db = await getDb();
  if ((await db.list()).includes(graph)) await db.selectGraph(graph).delete();
  await closeDb();
}
