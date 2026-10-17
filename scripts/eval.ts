// 20 seeded scenarios: temporal vs naive against an independent reference, min cut vs exhaustive optimum,
// reach after quarantine, read latency. Writes eval/results/latest.json.
import { mkdir, writeFile } from 'node:fs/promises';
import { closeDb, runEval } from '@quarantine/graph';

const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
const results = await runEval(seeds);
await mkdir('eval/results', { recursive: true });
await writeFile('eval/results/latest.json', `${JSON.stringify(results, null, 2)}\n`);

const f = (x: number) => x.toFixed(3);
const { summary: s } = results;
console.log(`scenarios                      ${s.scenarios}`);
console.log(`temporal precision / recall    ${f(s.temporal.precision)} / ${f(s.temporal.recall)}`);
console.log(`naive precision / recall       ${f(s.naive.precision)} / ${f(s.naive.recall)}`);
console.log(`false infections avoided       ${s.falseInfectionsAvoided}`);
console.log(`min cut = max flow = optimum   ${s.cutsOptimal}/${s.scenarios}`);
console.log(`reach 0 after quarantine       ${s.reachAfterQuarantineZero}/${s.scenarios}`);
for (const [name, l] of Object.entries(s.latencyMs))
  console.log(`  ${name.padEnd(28)} n=${l.n} p50=${l.p50}ms p95=${l.p95}ms`);
await closeDb();
process.exitCode =
  s.temporal.precision === 1 &&
  s.temporal.recall === 1 &&
  s.cutsOptimal === s.scenarios &&
  s.reachAfterQuarantineZero === s.scenarios
    ? 0
    : 1;
