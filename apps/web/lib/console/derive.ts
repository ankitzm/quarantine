import type {
  IncidentResponse,
  MemoryResponse,
  PlanResponse,
  TimelineEvent,
  TimelineResponse,
} from '@quarantine/graph/types';

type Trace = IncidentResponse['trace'];

/** Longest chain of infection causes from patient zero, counting agent-to-agent steps. */
export function hops(trace: Trace): number {
  const episodes = new Map(trace.episodes.map((e) => [e.id, e]));
  const items = new Map(trace.items.map((m) => [m.id, m]));
  const memo = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    if (memo.has(id)) return memo.get(id) ?? 0;
    if (seen.has(id)) return 0;
    seen.add(id);
    const node = episodes.get(id) ?? items.get(id);
    const from = node?.cause.from;
    const step = episodes.has(id) && node?.cause.edge !== 'SEED' ? 1 : 0;
    const d = from ? depth(from, seen) + step : 0;
    memo.set(id, d);
    return d;
  };
  return Math.max(0, ...trace.episodes.map((e) => depth(e.id, new Set())));
}

export type MemoryStatus = 'clean' | 'poison' | 'infected' | 'restored';

export interface MemoryChip {
  id: string;
  label: string;
  t: number;
  status: MemoryStatus;
  isInvalidated: boolean;
  isNaiveOnly: boolean;
  slot: number;
}

export interface Storyline {
  lanes: string[];
  events: (TimelineEvent & { slot: number; lane: number })[];
  chips: MemoryChip[];
  /** Slot index where each session starts, with the gap since the previous session. */
  breaks: { slot: number; label: string; gapMs: number }[];
  slots: number;
}

/**
 * Lays the timeline out on an ordinal axis: one slot per event, sessions separated by a break, so a
 * one-day gap does not leave the chart empty. Lanes put infected agents first, in order of infection
 * (patient zero on top), then everyone else in order of first appearance.
 */
export function storyline(
  timeline: TimelineResponse,
  memory: MemoryResponse,
  trace: Trace,
  naiveItems: string[],
): Storyline {
  const lanes = [...trace.agents].sort((a, b) => a.infectedAt - b.infectedAt).map((a) => a.id);
  for (const e of timeline.events) if (!lanes.includes(e.agent)) lanes.push(e.agent);
  const sessionStart = new Map<string, number>();
  const events = timeline.events.map((e, slot) => {
    if (!sessionStart.has(e.session)) sessionStart.set(e.session, slot);
    return { ...e, slot, lane: lanes.indexOf(e.agent) };
  });
  const sessions = timeline.sessions.filter((s) => sessionStart.has(s.id));
  const breaks = sessions.slice(1).map((s, i) => {
    const prev = sessions[i];
    const gapMs = s.t - (prev?.t ?? s.t);
    return { slot: sessionStart.get(s.id) ?? 0, label: gapLabel(gapMs), gapMs };
  });

  const infected = new Set(trace.items.map((m) => m.id));
  const writeSlot = new Map(events.filter((e) => e.kind === 'write').map((e) => [e.target, e]));
  const chips = memory.keys.flatMap((k) =>
    k.versions.flatMap((v) => {
      const write = writeSlot.get(v.id);
      if (!write) return [];
      const status: MemoryStatus =
        v.id === trace.seed.item
          ? 'poison'
          : infected.has(v.id)
            ? 'infected'
            : write.agent === 'quarantine'
              ? 'restored'
              : 'clean';
      return [
        {
          id: v.id,
          label: `${k.ns}/${k.key}${status === 'poison' ? ' · poisoned' : status === 'restored' ? ' · restored' : ''}`,
          t: v.validFrom,
          status,
          isInvalidated: v.isInvalidated,
          isNaiveOnly: naiveItems.includes(v.id),
          slot: write.slot,
        },
      ];
    }),
  );
  return { lanes, events, chips: chips.sort((a, b) => a.slot - b.slot), breaks, slots: events.length };
}

function gapLabel(ms: number): string {
  const h = ms / 3_600_000;
  if (h >= 20) return `+${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'}`;
  if (h >= 1) return `+${Math.round(h)} h`;
  return `+${Math.max(1, Math.round(ms / 60_000))} min`;
}

export interface BlastNode {
  id: string;
  column: 0 | 1 | 2 | 3;
  label: string;
  detail: string;
  sensitivity?: number;
  isCut: boolean;
}

export interface BlastEdge {
  from: string;
  to: string;
  isCut: boolean;
}

/**
 * The permission network behind a plan as four columns: agents, their tools grouped by server,
 * credentials, resources. Tools are grouped so the chart stays legible; a group is cut when the plan
 * revokes any of its tools, a credential when the plan rotates it.
 */
export function blastRadius(plan: PlanResponse): { nodes: BlastNode[]; edges: BlastEdge[] } {
  const nodes = new Map<string, BlastNode>();
  const edges = new Map<string, BlastEdge>();
  const revokedTools = new Set(
    plan.cut.filter((c) => c.action === 'revoke-tool').map((c) => `${c.from}|${c.to}`),
  );
  const rotated = new Set(plan.cut.flatMap((c) => (c.credential ? [c.credential] : [])));
  const groupTools = new Map<string, Set<string>>();

  const node = (n: BlastNode) => nodes.set(n.id, nodes.get(n.id) ?? n);
  const edge = (from: string, to: string, isCut: boolean) => {
    const key = `${from}>${to}`;
    const prev = edges.get(key);
    edges.set(key, { from, to, isCut: (prev?.isCut ?? false) || isCut });
  };

  for (const p of plan.reach) {
    const server = p.tool.slice(p.tool.indexOf(':') + 1).split('.')[0] ?? p.tool;
    const group = `tool:${p.agent}|${server}`;
    const tools = groupTools.get(group) ?? new Set<string>();
    tools.add(p.tool);
    groupTools.set(group, tools);
    node({ id: `agent:${p.agent}`, column: 0, label: p.agent, detail: '', isCut: false });
    node({ id: group, column: 1, label: server, detail: p.agent, isCut: false });
    node({
      id: `res:${p.resource}`,
      column: 3,
      label: p.uri,
      detail: p.kind,
      sensitivity: p.sensitivity,
      isCut: false,
    });
    edge(`agent:${p.agent}`, group, revokedTools.has(`${p.agent}|${p.tool}`));
    if (p.credential) {
      const cred = `cred:${p.credential}`;
      node({
        id: cred,
        column: 2,
        label: credentialLabel(p.credential),
        detail: p.credential,
        isCut: rotated.has(p.credential),
      });
      edge(group, cred, false);
      edge(cred, `res:${p.resource}`, rotated.has(p.credential));
    } else {
      edge(group, `res:${p.resource}`, false);
    }
  }
  for (const [id, tools] of groupTools) {
    const n = nodes.get(id);
    if (n) nodes.set(id, { ...n, detail: `${n.detail} · ${tools.size} tool${tools.size === 1 ? '' : 's'}` });
  }
  for (const e of edges.values()) {
    if (e.isCut && e.from.startsWith('agent:')) {
      const n = nodes.get(e.to);
      if (n) nodes.set(e.to, { ...n, isCut: true });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** postgres://user@host:5432/db -> user@db; env names stay as they are. */
export function credentialLabel(name: string): string {
  const m = /^postgres:\/\/([^@]+)@[^/]+\/(.+)$/.exec(name);
  return m ? `${m[1]}@${m[2]} (postgres)` : name;
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const clock = (t: number) => timeFmt.format(t);
export const day = (t: number) => dateFmt.format(t);
