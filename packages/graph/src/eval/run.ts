import { getDb } from '../client.ts';
import { Event, type EventInput } from '../events.ts';
import { applyEvents } from '../ingest.ts';
import { parseMcpConfig } from '../permissions/config.ts';
import { SENSITIVE } from '../permissions/manifests.ts';
import { exhaustiveMinCost } from '../permissions/mincut.ts';
import { applyQuarantine, planQuarantine } from '../permissions/plan.ts';
import { network } from '../queries/permissions.ts';
import { queryEvents, run, type QueryLogEntry } from '../run.ts';
import { ensureSchema, markGraphReady } from '../schema.ts';
import { trace } from '../trace.ts';
import { generateScenario } from './generate.ts';
import { referenceTrace, score, type Score } from './reference.ts';

export interface ScenarioResult {
  seed: number;
  events: number;
  agents: number;
  temporal: { episodes: Score; decisions: Score };
  naive: { episodes: Score; decisions: Score };
  /** Infected episodes the naive trace flags but the reference does not. */
  falseInfectionsAvoided: number;
  cut: { cost: number; maxFlow: number; optimum: number; revocations: number };
  reachBefore: number;
  reachAfter: number;
}

export interface EvalResults {
  generatedAt: number;
  scenarios: ScenarioResult[];
  summary: {
    scenarios: number;
    temporal: { precision: number; recall: number };
    naive: { precision: number; recall: number };
    falseInfectionsAvoided: number;
    cutsOptimal: number;
    reachAfterQuarantineZero: number;
    latencyMs: Record<string, { n: number; p50: number; p95: number }>;
  };
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const micro = (scores: Score[]) => {
  const tp = scores.reduce((s, x) => s + x.tp, 0);
  const fp = scores.reduce((s, x) => s + x.fp, 0);
  const fn = scores.reduce((s, x) => s + x.fn, 0);
  return { precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1 };
};

async function evaluate(seed: number): Promise<ScenarioResult> {
  const s = generateScenario(seed);
  const graph = `eval_${seed}`;
  const db = await getDb();
  if ((await db.list()).includes(graph)) await db.selectGraph(graph).delete();
  await ensureSchema(graph);
  const permissions: EventInput[] = Object.entries(s.configs).map(([agent, cfg]) => ({
    type: 'PermissionConfig',
    t: 0,
    agent,
    grants: parseMcpConfig(s.tenant, agent, cfg, `eval:${agent}`).grants,
  }));
  await applyEvents(graph, [...permissions, ...s.events]);
  await markGraphReady(graph, s.tenant);

  try {
    const ref = referenceTrace(Event.array().parse(s.events), s.poison);
    const [temporal, naive] = await Promise.all([
      trace(graph, s.poison, 'temporal'),
      trace(graph, s.poison, 'naive'),
    ]);
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    const plan = await planQuarantine(graph, s.poison);
    const edges = await run(graph, network, { agents: plan.agents, minSensitivity: SENSITIVE });
    const sinks = new Set(edges.filter((e) => e.toKey.startsWith('Resource:')).map((e) => e.to));
    const optimum = plan.reach.length ? exhaustiveMinCost(edges, sinks) : 0;
    const applied = await applyQuarantine(graph, plan.id, { confirm: true });
    const naiveEpisodes = score(ids(naive.episodes), ref.episodes.keys());
    return {
      seed,
      events: s.events.length,
      agents: Object.keys(s.configs).length,
      temporal: {
        episodes: score(ids(temporal.episodes), ref.episodes.keys()),
        decisions: score(ids(temporal.decisions), ref.decisions),
      },
      naive: { episodes: naiveEpisodes, decisions: score(ids(naive.decisions), ref.decisions) },
      falseInfectionsAvoided: naiveEpisodes.fp,
      cut: { cost: plan.totalCost, maxFlow: plan.maxFlow, optimum, revocations: plan.cut.length },
      reachBefore: plan.reach.length,
      reachAfter: applied.reachAfter.length,
    };
  } finally {
    await db.selectGraph(graph).delete();
  }
}

/** Runs every seeded scenario and aggregates precision/recall, cut optimality, reach and read latency. */
export async function runEval(seeds: number[]): Promise<EvalResults> {
  const latencies = new Map<string, number[]>();
  const onQuery = (e: QueryLogEntry) => {
    if (e.mode === 'read' && !e.error) latencies.set(e.name, [...(latencies.get(e.name) ?? []), e.ms]);
  };
  queryEvents.on('query', onQuery);
  const scenarios: ScenarioResult[] = [];
  try {
    for (const seed of seeds) scenarios.push(await evaluate(seed));
  } finally {
    queryEvents.off('query', onQuery);
  }
  return {
    generatedAt: Date.now(),
    scenarios,
    summary: {
      scenarios: scenarios.length,
      temporal: micro(scenarios.map((s) => s.temporal.episodes)),
      naive: micro(scenarios.map((s) => s.naive.episodes)),
      falseInfectionsAvoided: scenarios.reduce((n, s) => n + s.falseInfectionsAvoided, 0),
      cutsOptimal: scenarios.filter((s) => s.cut.cost === s.cut.optimum && s.cut.cost === s.cut.maxFlow)
        .length,
      reachAfterQuarantineZero: scenarios.filter((s) => s.reachAfter === 0).length,
      latencyMs: Object.fromEntries(
        [...latencies]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, ms]) => [name, { n: ms.length, p50: pct(ms, 50), p95: pct(ms, 95) }]),
      ),
    },
  };
}
