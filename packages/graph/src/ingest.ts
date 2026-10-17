import { Event, INFINITE_CAPACITY, memoryKind, type EventInput } from './events.ts';
import * as q from './queries/ingest.ts';
import type { Query } from './queries/types.ts';
import { run, type Params } from './run.ts';

export class IngestError extends Error {
  override name = 'IngestError';
}

/**
 * The single write path. Validates every event, applies them in time order (stable for ties), and fails
 * loudly on a reference to a node that does not exist. Every write MERGEs on a stable id, so applying the
 * same events twice leaves the graph unchanged.
 */
export async function applyEvents(graph: string, input: readonly EventInput[]): Promise<number> {
  const events = Event.array()
    .parse(input)
    .map((e, i) => [e, i] as const)
    .sort(([a, i], [b, j]) => a.t - b.t || i - j)
    .map(([e]) => e);
  // ponytail: one round trip per statement; batch with UNWIND per event type if replay time matters.
  for (const e of events) await apply(graph, e);
  return events.length;
}

async function apply(graph: string, e: Event): Promise<void> {
  const write = async (query: Query<{ n: number }>, params: Params, expected = 1) => {
    const [row] = await run(graph, query, params);
    if ((row?.n ?? 0) !== expected) {
      throw new IngestError(
        `${e.type} at t=${e.t}: ${query.name} matched ${row?.n ?? 0}/${expected}, unknown reference`,
      );
    }
  };

  switch (e.type) {
    case 'Session':
      return write(q.writeSession, { id: e.id, t: e.t, tenant: e.tenant, label: e.label ?? null });
    case 'Episode':
      return write(q.writeEpisode, { id: e.id, t: e.t, session: e.session, agent: e.agent });
    case 'Input':
      return write(q.writeInput, {
        id: e.id,
        t: e.t,
        episode: e.episode,
        source: e.source,
        text: e.text,
        uri: e.uri ?? null,
      });
    case 'MemoryWrite': {
      const ns = e.ns.join('/');
      await write(q.writeMemory, {
        id: e.id,
        t: e.t,
        episode: e.episode,
        ns,
        key: e.key,
        kind: memoryKind(e.ns),
        text: e.text,
        value: e.value ?? null,
      });
      if (e.derivedFrom.length)
        await write(q.writeDerivedFrom, { id: e.id, sources: e.derivedFrom }, e.derivedFrom.length);
      if (e.supersedes) await write(q.writeSupersedes, { id: e.id, old: e.supersedes, t: e.t });
      return;
    }
    case 'MemoryDelete':
      return write(q.writeDelete, { episode: e.episode, item: e.item, t: e.t });
    case 'MemoryRead':
      return write(q.writeRead, { episode: e.episode, item: e.item, t: e.t });
    case 'Handoff':
      return write(q.writeHandoff, { from: e.from, to: e.to, t: e.t, summary: e.summary });
    case 'Decision':
      await write(q.writeDecision, { id: e.id, t: e.t, episode: e.episode, text: e.text });
      if (e.basedOn.length) await write(q.writeBasedOn, { id: e.id, items: e.basedOn }, e.basedOn.length);
      return;
    case 'ToolCall':
      return write(q.writeToolCall, {
        id: e.id,
        t: e.t,
        episode: e.episode,
        tool: e.tool,
        args: e.args,
        outcome: e.outcome,
      });
    case 'PermissionConfig':
      for (const g of e.grants) {
        const base = { tool: g.tool.id, source: g.source, inf: INFINITE_CAPACITY };
        await write(q.writeCanUse, {
          ...base,
          agent: e.agent,
          name: g.tool.name,
          server: g.tool.server,
          cost: g.cost,
        });
        const n = g.resources.length;
        if (g.credential) {
          const { id, envName, rotateCost } = g.credential;
          await write(q.writeCredential, { ...base, id, envName, rotateCost });
          if (n) await write(q.writeGrants, { ...base, credential: id, resources: g.resources }, n);
        } else if (n) {
          await write(q.writeActsOn, { ...base, resources: g.resources }, n);
        }
      }
      return;
  }
}
