// Run the Sentinel live against a scratch copy of the acme graph, or replay a recorded run.
// Usage: pnpm sentinel            live via OpenRouter (OPENROUTER_API_KEY, LLM_MODEL), writes the run file
//        pnpm sentinel --replay   re-executes the recorded tool calls and reports any drift
import { readFile, writeFile } from 'node:fs/promises';
import { ChatOpenAI } from '@langchain/openai';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { closeDb, getDb, loadFixture, readConfigEvents, readFixtures } from '@quarantine/graph';
import { createMcpServer } from '@quarantine/graph/mcp';
import { replaySentinel, runSentinel, type SentinelRun } from '@quarantine/swarm';
import { z } from 'zod';

const FILE = 'fixtures/runs/live/sentinel.json';
const ALERT =
  'Alert from Stripe: Billing issued a $4,800 refund on ticket #4471 to a new card without manager approval, ' +
  'and Ops made an outbound POST to audit-sync.example. Investigate.';

const graph = 'sentinel_acme';
const fixture = (await readFixtures('fixtures/runs')).find((f) => f.tenant === 'acme');
if (!fixture) throw new Error('no acme fixture');
await loadFixture(graph, fixture, await readConfigEvents('fixtures/configs/acme', 'acme', 0));

const [server, transport] = InMemoryTransport.createLinkedPair();
await createMcpServer(graph).connect(server);
const client = new Client({ name: 'sentinel', version: '0.1.0' });
await client.connect(transport);

if (process.argv.includes('--replay')) {
  const run = JSON.parse(await readFile(FILE, 'utf8')) as SentinelRun;
  const drift = await replaySentinel(client, run);
  console.log(
    drift.length
      ? `drift in ${drift.map((d) => d.tool).join(', ')}`
      : `replayed ${run.calls.length} calls, no drift`,
  );
  process.exitCode = drift.length ? 1 : 0;
} else {
  try {
    process.loadEnvFile('.env');
  } catch {
    // env may come from the shell
  }
  const env = z
    .object({ OPENROUTER_API_KEY: z.string().min(1), LLM_MODEL: z.string().min(1) })
    .parse(process.env);
  const model = new ChatOpenAI({
    model: env.LLM_MODEL,
    apiKey: env.OPENROUTER_API_KEY,
    temperature: 0,
    configuration: { baseURL: 'https://openrouter.ai/api/v1' },
  });
  const run = await runSentinel({ model, client, alert: ALERT });
  const json = `${JSON.stringify({ model: env.LLM_MODEL, fixture: fixture.run, ...run }, null, 2)}\n`;
  if (json.includes(env.OPENROUTER_API_KEY)) throw new Error('API key in Sentinel output');
  await writeFile(FILE, json);
  console.log(run.calls.map((c) => c.tool).join(' -> '));
  console.log(run.narrative);
}

await client.close();
await (await getDb()).selectGraph(graph).delete();
await closeDb();
