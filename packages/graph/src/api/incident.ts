import { reachOf } from '../permissions/plan.ts';
import { sessions as sessionsQuery, activity } from '../queries/views.ts';
import { run } from '../run.ts';
import { assertReady } from '../schema.ts';
import { trace, type TraceMode, type TraceResult, type TraceRound } from '../trace.ts';
import type { IncidentResponse, ReachResponse, TimelineEvent, TimelineResponse } from '../types/api.ts';

const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
const minus = (a: { id: string }[], b: { id: string }[]) => {
  const keep = ids(b);
  return a.map((x) => x.id).filter((id) => !keep.has(id));
};

async function both(
  graph: string,
  seed: string,
  watch?: { mode: TraceMode; onRound: (r: TraceRound) => void },
): Promise<{ temporal: TraceResult; naive: TraceResult }> {
  const on = (mode: TraceMode) => (watch?.mode === mode ? watch.onRound : undefined);
  const [temporal, naive] = await Promise.all([
    trace(graph, seed, 'temporal', on('temporal')),
    trace(graph, seed, 'naive', on('naive')),
  ]);
  return { temporal, naive };
}

export async function buildIncident(
  graph: string,
  { seed, mode, onRound }: { seed: string; mode: TraceMode; onRound?: (r: TraceRound) => void },
): Promise<IncidentResponse> {
  const tenant = await assertReady(graph);
  const { temporal, naive } = await both(graph, seed, onRound && { mode, onRound });
  return {
    tenant,
    trace: mode === 'temporal' ? temporal : naive,
    naiveFalsePositives: {
      episodes: minus(naive.episodes, temporal.episodes),
      items: minus(naive.items, temporal.items),
      decisions: minus(naive.decisions, temporal.decisions),
      toolCalls: minus(naive.toolCalls, temporal.toolCalls),
    },
  };
}

const KIND: Record<string, TimelineEvent['kind']> = {
  RECEIVED: 'input',
  WROTE: 'write',
  READ: 'read',
  HANDED_OFF: 'handoff',
  DECIDED: 'decision',
  CALLED: 'toolCall',
};
const MAX_DETAIL = 280;

/** Every episode action in time order, marked with whether the temporal or only the naive trace flags it. */
export async function buildTimeline(graph: string, { seed }: { seed: string }): Promise<TimelineResponse> {
  const tenant = await assertReady(graph);
  const [{ temporal, naive }, sessions, rows] = await Promise.all([
    both(graph, seed),
    run(graph, sessionsQuery),
    run(graph, activity),
  ]);
  // An action is flagged when its actor was infected by then (any time, for the time-blind naive trace)
  // or when it acted on something the trace flagged.
  const flagged = (t: TraceResult) => {
    const since = new Map(t.episodes.map((e) => [e.id, t.mode === 'naive' ? -Infinity : e.infectedAt]));
    const targets = new Set([...ids(t.items), ...ids(t.decisions), ...ids(t.toolCalls)]);
    return (r: (typeof rows)[number]) => r.t >= (since.get(r.episode) ?? Infinity) || targets.has(r.target);
  };
  const [isTemporal, isNaive] = [flagged(temporal), flagged(naive)];

  return {
    tenant,
    seed,
    sessions,
    events: rows.map((r) => {
      const isInfected = isTemporal(r);
      const detail = r.detail ?? '';
      return {
        t: r.t,
        kind: KIND[r.rel] ?? 'input',
        session: r.session,
        episode: r.episode,
        agent: r.agent,
        target: r.target,
        targetAgent: r.targetAgent,
        detail: detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL)}…` : detail,
        isInfected,
        isNaiveOnly: !isInfected && isNaive(r),
      };
    }),
  };
}

/** What the infected agents can still touch: live paths to sensitive resources, grouped by resource. */
export async function buildReach(graph: string, { seed }: { seed: string }): Promise<ReachResponse> {
  const tenant = await assertReady(graph);
  const agents = (await trace(graph, seed, 'temporal')).agents.map((a) => a.id).sort();
  const paths = await reachOf(graph, agents);
  const resources = new Map<string, ReachResponse['resources'][number]>();
  for (const p of paths) {
    const r = resources.get(p.resource) ?? {
      id: p.resource,
      uri: p.uri,
      kind: p.kind,
      sensitivity: p.sensitivity,
      agents: [],
    };
    if (!r.agents.includes(p.agent)) r.agents.push(p.agent);
    resources.set(p.resource, r);
  }
  return {
    tenant,
    seed,
    agents,
    paths,
    resources: [...resources.values()].sort(
      (a, b) => b.sensitivity - a.sensitivity || a.uri.localeCompare(b.uri),
    ),
  };
}
