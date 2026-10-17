import { SeedNotFound } from './errors.ts';
import * as q from './queries/trace.ts';
import type { Arrival } from './queries/trace.ts';
import { run } from './run.ts';

export type TraceMode = 'temporal' | 'naive';

export interface Cause {
  edge: Arrival['edge'] | 'SEED';
  from: string | null;
}

export interface TraceResult {
  mode: TraceMode;
  seed: { item: string; episode: string; agent: string; at: number };
  rounds: number;
  episodes: { id: string; agent: string; session: string; infectedAt: number; cause: Cause }[];
  items: {
    id: string;
    ns: string;
    key: string;
    kind: string;
    text: string;
    validFrom: number;
    validTo: number | null;
    infectedAt: number;
    cause: Cause;
  }[];
  agents: { id: string; infectedAt: number }[];
  decisions: q.DecisionRow[];
  toolCalls: q.ToolCallRow[];
}

type Infection = { at: number; cause: Cause };
const MAX_ROUNDS = 100;

/**
 * Forward infection trace from a poisoned memory version.
 *
 * temporal: earliest-arrival relaxation to a fixpoint. Each node keeps the earliest time infection can
 * reach it and the edge that carried it; only the nodes that improved in a round are relaxed next.
 *
 * naive: the same rules with time ignored and memory identified by (ns, key), which is what
 * "who touched the refund SOP?" looks like without bitemporal versions.
 */
export interface TraceRound {
  round: number;
  /** Nodes whose infection was found or moved earlier this round. */
  episodes: { id: string; infectedAt: number; cause: Cause }[];
  items: { id: string; infectedAt: number; cause: Cause }[];
}

export async function trace(
  graph: string,
  seedItem: string,
  mode: TraceMode,
  onRound?: (round: TraceRound) => void,
): Promise<TraceResult> {
  const [seed] = await run(graph, q.traceSeed, { id: seedItem });
  if (!seed) throw new SeedNotFound(seedItem);

  const time = (at: number) => (mode === 'naive' ? 0 : at);
  const episodes = new Map<string, Infection>([
    [seed.episode, { at: seed.at, cause: { edge: 'SEED', from: null } }],
  ]);
  const items = new Map<string, Infection>([[seed.id, { at: seed.at, cause: { edge: 'SEED', from: null } }]]);
  let frontier = { episodes: [seed.episode], items: [seed.id] };
  const at = (known: Map<string, Infection>) => (id: string) => ({ id, at: time(must(known, id).at) });
  let rounds = 0;

  const seedCause: Cause = { edge: 'SEED', from: null };
  onRound?.({
    round: 0,
    episodes: [{ id: seed.episode, infectedAt: seed.at, cause: seedCause }],
    items: [{ id: seed.id, infectedAt: seed.at, cause: seedCause }],
  });

  while (frontier.episodes.length + frontier.items.length > 0) {
    if (++rounds > MAX_ROUNDS) throw new Error(`trace did not converge in ${MAX_ROUNDS} rounds`);
    const params = {
      episodes: frontier.episodes.map(at(episodes)),
      items: frontier.items.map(at(items)),
    };
    const [toItems, toEpisodes, viaHandoff, viaDerived, viaKey] = await Promise.all([
      run(graph, q.traceWrote, params),
      run(graph, q.traceRead, params),
      run(graph, q.traceHandoff, params),
      run(graph, q.traceDerived, params),
      mode === 'naive' ? run(graph, q.traceSameKey, params) : [],
    ]);
    frontier = {
      episodes: relax(episodes, [...toEpisodes, ...viaHandoff], mode),
      items: relax(items, [...toItems, ...viaDerived, ...viaKey], mode),
    };
    const changed = (known: Map<string, Infection>, ids: string[]) =>
      ids.map((id) => ({ id, infectedAt: must(known, id).at, cause: must(known, id).cause }));
    onRound?.({
      round: rounds,
      episodes: changed(episodes, frontier.episodes),
      items: changed(items, frontier.items),
    });
  }

  const infectedEpisodes = [...episodes.keys()].map(at(episodes));
  const [episodeRows, itemRows, decisions, toolCalls] = await Promise.all([
    run(graph, q.traceEpisodes, { ids: [...episodes.keys()] }),
    run(graph, q.traceItems, { ids: [...items.keys()] }),
    run(graph, q.traceDecisions, { episodes: infectedEpisodes, itemIds: [...items.keys()] }),
    run(graph, q.traceToolCalls, { episodes: infectedEpisodes }),
  ]);

  const byTime = <T extends { infectedAt: number; id: string }>(a: T, b: T) =>
    a.infectedAt - b.infectedAt || a.id.localeCompare(b.id);
  const outEpisodes = episodeRows
    .map(({ t: _t, ...e }) => ({
      ...e,
      infectedAt: must(episodes, e.id).at,
      cause: must(episodes, e.id).cause,
    }))
    .sort(byTime);
  const agents = new Map<string, number>();
  for (const e of outEpisodes) agents.set(e.agent, Math.min(agents.get(e.agent) ?? Infinity, e.infectedAt));

  return {
    mode,
    seed: { item: seed.id, episode: seed.episode, agent: seed.agent, at: seed.at },
    rounds,
    episodes: outEpisodes,
    items: itemRows
      .map((m) => ({ ...m, infectedAt: must(items, m.id).at, cause: must(items, m.id).cause }))
      .sort(byTime),
    agents: [...agents].map(([id, infectedAt]) => ({ id, infectedAt })).sort(byTime),
    decisions,
    toolCalls,
  };
}

/**
 * temporal: keep an arrival if it beats the known infection time. naive: plain BFS, first visit wins.
 * Returns the ids that changed, which become the next frontier.
 */
function relax(known: Map<string, Infection>, arrivals: Arrival[], mode: TraceMode): string[] {
  const improved = new Set<string>();
  for (const a of arrivals) {
    const current = known.get(a.id);
    if (current && (mode === 'naive' || current.at <= a.at)) continue;
    known.set(a.id, { at: a.at, cause: { edge: a.edge, from: a.via } });
    improved.add(a.id);
  }
  return [...improved].sort();
}

function must(known: Map<string, Infection>, id: string): Infection {
  const inf = known.get(id);
  if (!inf) throw new Error(`trace lost track of ${id}`);
  return inf;
}
