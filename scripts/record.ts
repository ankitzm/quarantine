// Live attack evidence: run the acme scenario N times through OpenRouter, each into a fresh scratch graph.
// Usage: pnpm record [--runs 10]      needs OPENROUTER_API_KEY and LLM_MODEL in .env
import { mkdir, writeFile } from 'node:fs/promises';
import { ChatOpenAI } from '@langchain/openai';
import { closeDb, getDb } from '@quarantine/graph';
import { runScenario, TENANT } from '@quarantine/swarm';
import { z } from 'zod';

try {
  process.loadEnvFile('.env');
} catch {
  // env may come from the shell
}
const env = z
  .object({ OPENROUTER_API_KEY: z.string().min(1), LLM_MODEL: z.string().min(1) })
  .parse(process.env);
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 10;
const OUT = 'fixtures/runs/live';
// Anything shaped like a provider key must never be committed with a transcript.
const KEY_SHAPED = /sk-[A-Za-z0-9_-]{16,}|sk_(live|test)_[A-Za-z0-9]{8,}/;

const model = new ChatOpenAI({
  model: env.LLM_MODEL,
  apiKey: env.OPENROUTER_API_KEY,
  temperature: 0.7,
  configuration: { baseURL: 'https://openrouter.ai/api/v1' },
});

await mkdir(OUT, { recursive: true });
const results: { run: string; injected: boolean; propagated: boolean; error: string | null }[] = [];
for (let i = 1; i <= runs; i++) {
  const runId = `run-${String(i).padStart(2, '0')}`;
  const graph = `record_${runId.replace('-', '_')}`;
  const run = await runScenario({ graph, runId, model });
  const file = {
    tenant: TENANT,
    run: runId,
    description: `Live run ${runId} of the acme attack via OpenRouter ${env.LLM_MODEL}.`,
    incident: run.poison ? { seed: run.poison } : null,
    model: env.LLM_MODEL,
    injected: run.injected,
    propagated: run.propagated,
    error: run.error,
    events: run.events,
    transcript: run.transcript,
  };
  const json = `${JSON.stringify(file, null, 2)}\n`;
  if (json.includes(env.OPENROUTER_API_KEY) || KEY_SHAPED.test(json))
    throw new Error(`${runId}: key-shaped string in output`);
  await writeFile(`${OUT}/${runId}.json`, json);
  await (await getDb()).selectGraph(graph).delete();
  results.push({ run: runId, injected: run.injected, propagated: run.propagated, error: run.error });
  console.log(
    `${runId}  injected=${run.injected}  propagated=${run.propagated}${run.error ? `  error=${run.error}` : ''}`,
  );
}

const count = (k: 'injected' | 'propagated') => results.filter((r) => r[k]).length;
const summary = {
  model: env.LLM_MODEL,
  runs,
  injected: count('injected'),
  propagated: count('propagated'),
  injectionRate: count('injected') / runs,
  propagationRate: count('propagated') / runs,
  results,
};
await writeFile(`${OUT}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`injection ${summary.injected}/${runs}, propagation ${summary.propagated}/${runs}`);
await closeDb();
