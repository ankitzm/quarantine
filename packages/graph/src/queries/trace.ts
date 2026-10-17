import { defineQuery } from './types.ts';

// Earliest-arrival relaxation. Each round feeds the frontier ($episodes / $items, each {id, at}) through
// the four propagation rules below; the time comparison lives in Cypher, so an edge only carries the
// infection if it happened at or after the source was infected. The naive baseline runs the same rules
// with every `at` forced to 0 (time ignored) plus sameKey.

export interface Arrival {
  id: string;
  at: number;
  via: string;
  edge: 'WROTE' | 'READ' | 'HANDED_OFF' | 'DERIVED_FROM' | 'SAME_KEY';
}

export const traceSeed = defineQuery<{
  id: string;
  at: number;
  episode: string;
  agent: string;
}>({
  name: 'trace.seed',
  description: 'The poisoned memory version and the episode that wrote it (patient zero).',
  mode: 'read',
  cypher: `MATCH (e:Episode)-[w:WROTE]->(m:MemoryItem {id: $id})
           RETURN m.id AS id, m.valid_from AS at, e.id AS episode, e.agent AS agent
           ORDER BY w.t LIMIT 1`,
});

export const traceWrote = defineQuery<Arrival>({
  name: 'trace.wrote',
  description: 'An infected episode infects every memory version it writes after its infection.',
  mode: 'read',
  cypher: `UNWIND $episodes AS inf
           MATCH (e:Episode {id: inf.id})-[w:WROTE]->(m:MemoryItem)
           WHERE w.t >= inf.at
           RETURN m.id AS id, w.t AS at, e.id AS via, 'WROTE' AS edge`,
});

export const traceRead = defineQuery<Arrival>({
  name: 'trace.read',
  description: 'An infected memory version infects every episode that reads it after its infection.',
  mode: 'read',
  cypher: `UNWIND $items AS inf
           MATCH (e:Episode)-[r:READ]->(m:MemoryItem {id: inf.id})
           WHERE r.t >= inf.at
           RETURN e.id AS id, r.t AS at, m.id AS via, 'READ' AS edge`,
});

export const traceHandoff = defineQuery<Arrival>({
  name: 'trace.handoff',
  description:
    'An infected episode infects the episode it hands off to, if the handoff came after infection.',
  mode: 'read',
  cypher: `UNWIND $episodes AS inf
           MATCH (a:Episode {id: inf.id})-[h:HANDED_OFF]->(b:Episode)
           WHERE h.t >= inf.at
           RETURN b.id AS id, h.t AS at, a.id AS via, 'HANDED_OFF' AS edge`,
});

export const traceDerived = defineQuery<Arrival>({
  name: 'trace.derived',
  description: 'A memory version derived from an infected one, written after its infection, is infected.',
  mode: 'read',
  cypher: `UNWIND $items AS inf
           MATCH (d:MemoryItem)-[:DERIVED_FROM]->(m:MemoryItem {id: inf.id})
           WHERE d.valid_from >= inf.at
           RETURN d.id AS id, d.valid_from AS at, m.id AS via, 'DERIVED_FROM' AS edge`,
});

export const traceSameKey = defineQuery<Arrival>({
  name: 'trace.naive.sameKey',
  description:
    'Naive baseline only: without versioning, memory is identified by (ns, key), so every version of a ' +
    'poisoned key counts as poisoned, in both directions along SUPERSEDES.',
  mode: 'read',
  cypher: `UNWIND $items AS inf
           MATCH (m:MemoryItem {id: inf.id}), (o:MemoryItem)
           WHERE o.ns = m.ns AND o.key = m.key AND o.id <> m.id
           RETURN o.id AS id, o.valid_from AS at, m.id AS via, 'SAME_KEY' AS edge`,
});

export const traceEpisodes = defineQuery<{ id: string; agent: string; session: string; t: number }>({
  name: 'trace.episodes',
  description: 'Details for the infected episodes.',
  mode: 'read',
  cypher: `UNWIND $ids AS id
           MATCH (e:Episode {id: id})
           RETURN e.id AS id, e.agent AS agent, e.session AS session, e.t AS t`,
});

export const traceItems = defineQuery<{
  id: string;
  ns: string;
  key: string;
  kind: string;
  text: string;
  validFrom: number;
  validTo: number | null;
}>({
  name: 'trace.items',
  description: 'Details for the infected memory versions.',
  mode: 'read',
  cypher: `UNWIND $ids AS id
           MATCH (m:MemoryItem {id: id})
           RETURN m.id AS id, m.ns AS ns, m.key AS key, m.kind AS kind, m.text AS text,
                  m.valid_from AS validFrom, m.valid_to AS validTo`,
});

export interface DecisionRow {
  id: string;
  t: number;
  text: string;
  episode: string;
  agent: string;
  /** Made by an infected episode after its infection. */
  byAgent: boolean;
  /** Infected memory versions it cited. */
  basedOn: string[];
}

export const traceDecisions = defineQuery<DecisionRow>({
  name: 'trace.decisions',
  description:
    'Decisions to review: made by an infected episode after its infection, or citing an infected memory version.',
  mode: 'read',
  cypher: `MATCH (e:Episode)-[:DECIDED]->(d:Decision)
           OPTIONAL MATCH (d)-[:BASED_ON]->(m:MemoryItem)
           WITH e, d, collect(m.id) AS cited
           WITH e, d, [c IN cited WHERE c IN $itemIds] AS basedOn,
                [inf IN $episodes WHERE inf.id = e.id AND d.t >= inf.at] AS hit
           WHERE size(basedOn) > 0 OR size(hit) > 0
           RETURN d.id AS id, d.t AS t, d.text AS text, e.id AS episode, e.agent AS agent,
                  size(hit) > 0 AS byAgent, basedOn
           ORDER BY d.t`,
});

export interface ToolCallRow {
  id: string;
  t: number;
  tool: string;
  args: string;
  outcome: string;
  episode: string;
  agent: string;
}

export const traceToolCalls = defineQuery<ToolCallRow>({
  name: 'trace.toolCalls',
  description: 'Tool calls an infected episode made after its infection.',
  mode: 'read',
  cypher: `UNWIND $episodes AS inf
           MATCH (e:Episode {id: inf.id})-[:CALLED]->(c:ToolCall)
           WHERE c.t >= inf.at
           RETURN c.id AS id, c.t AS t, c.tool AS tool, c.args AS args, c.outcome AS outcome,
                  e.id AS episode, e.agent AS agent
           ORDER BY c.t`,
});
