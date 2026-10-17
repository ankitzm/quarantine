// Concurrency benchmark: N simulated agents doing mixed FalkorDBStore puts and searches against one engine.
// Usage: tsx scripts/bench.ts <port> <label>    (pnpm bench runs 6.0.2 on 6379 and 4.22.1 on 6380)
import { mkdir, writeFile } from 'node:fs/promises';

const [port = '6379', label = 'falkordb'] = process.argv.slice(2);
process.env.FALKORDB_PORT = port;
const { applyEvents, closeDb, ensureSchema, FalkorDBStore, getDb } = await import('@quarantine/graph');

const LEVELS = [8, 16, 32];
const OPS_PER_AGENT = 60;
const WRITE_SHARE = 0.4;
const WORDS = [
  'refund',
  'approval',
  'escrow',
  'invoice',
  'vendor',
  'audit',
  'card',
  'policy',
  'ticket',
  'customer',
];

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round((s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0) * 100) / 100;
};

async function level(agents: number) {
  const graph = `bench_${label.replace(/\W/g, '_')}_${agents}`;
  const db = await getDb();
  if ((await db.list()).includes(graph)) await db.selectGraph(graph).delete();
  await ensureSchema(graph);
  await applyEvents(graph, [
    { type: 'Session', id: 's', t: 0, tenant: 'bench' },
    ...Array.from({ length: agents }, (_, i) => ({
      type: 'Episode' as const,
      id: `e${i}`,
      t: 1,
      session: 's',
      agent: `a${i}`,
    })),
  ]);
  const store = new FalkorDBStore(graph);
  // Seed 200 shared items to search over.
  const seeder = store.as({ episodeId: 'e0' });
  for (let i = 0; i < 200; i++) {
    await seeder.put(['kb'], `doc-${i}`, { text: `${WORDS[i % 10]} ${WORDS[(i * 7) % 10]} note ${i}` });
  }

  const reads: number[] = [];
  const writes: number[] = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: agents }, async (_, a) => {
      const me = store.as({ episodeId: `e${a}` });
      for (let op = 0; op < OPS_PER_AGENT; op++) {
        const t0 = performance.now();
        // Each agent writes its own keys: concurrent puts to one key race (see FalkorDBStore.putOp).
        if ((op * 7 + a) % 10 < WRITE_SHARE * 10) {
          await me.put(['agents', `a${a}`], `k${op % 5}`, { text: `${WORDS[op % 10]} from a${a} op ${op}` });
          writes.push(performance.now() - t0);
        } else {
          await me.search(['kb'], { query: WORDS[(op + a) % 10] ?? 'refund', limit: 5 });
          reads.push(performance.now() - t0);
        }
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  await db.selectGraph(graph).delete();
  return {
    agents,
    ops: reads.length + writes.length,
    throughputOpsPerSec: Math.round((reads.length + writes.length) / seconds),
    read: { n: reads.length, p50: pct(reads, 50), p95: pct(reads, 95) },
    write: { n: writes.length, p50: pct(writes, 50), p95: pct(writes, 95) },
  };
}

const results = [];
for (const n of LEVELS) {
  const r = await level(n);
  results.push(r);
  console.log(
    `${label}  agents=${String(n).padStart(2)}  ${String(r.throughputOpsPerSec).padStart(5)} ops/s  ` +
      `read p50/p95 ${r.read.p50}/${r.read.p95}ms  write p50/p95 ${r.write.p50}/${r.write.p95}ms`,
  );
}
await mkdir('eval/results', { recursive: true });
await writeFile(
  `eval/results/bench-${label}.json`,
  `${JSON.stringify({ engine: label, port: Number(port), generatedAt: Date.now(), opsPerAgent: OPS_PER_AGENT, writeShare: WRITE_SHARE, connection: 'one shared client', results }, null, 2)}\n`,
);
await closeDb();
