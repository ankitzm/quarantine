import { defineQuery } from './types.ts';

export const sessions = defineQuery<{ id: string; label: string | null; t: number }>({
  name: 'view.sessions',
  description: 'All sessions in time order.',
  mode: 'read',
  cypher: 'MATCH (s:Session) RETURN s.id AS id, s.label AS label, s.t AS t ORDER BY s.t',
});

export interface ActivityRow {
  t: number;
  rel: string;
  session: string;
  episode: string;
  agent: string;
  target: string;
  targetAgent: string | null;
  detail: string | null;
}

export const activity = defineQuery<ActivityRow>({
  name: 'view.activity',
  description: 'Everything every episode did, in time order: the raw material of the incident timeline.',
  mode: 'read',
  cypher: `MATCH (e:Episode)-[r:RECEIVED|WROTE|READ|HANDED_OFF|DECIDED|CALLED]->(x)
           RETURN r.t AS t, type(r) AS rel, e.session AS session, e.id AS episode, e.agent AS agent,
                  x.id AS target, coalesce(x.agent, x.tool) AS targetAgent,
                  CASE type(r)
                    WHEN 'HANDED_OFF' THEN r.summary
                    WHEN 'CALLED' THEN x.args
                    WHEN 'WROTE' THEN x.ns + '/' + x.key + ': ' + x.text
                    WHEN 'READ' THEN x.ns + '/' + x.key
                    ELSE x.text
                  END AS detail
           ORDER BY t, episode, target`,
});

export interface VersionRow {
  id: string;
  ns: string;
  key: string;
  kind: string;
  text: string;
  validFrom: number;
  validTo: number | null;
  invalidated: boolean;
  episode: string;
  agent: string;
  supersedes: string | null;
}

const VERSION_FIELDS = `m.id AS id, m.ns AS ns, m.key AS key, m.kind AS kind, m.text AS text,
                  m.valid_from AS validFrom, m.valid_to AS validTo, coalesce(m.invalidated, false) AS invalidated,
                  e.id AS episode, e.agent AS agent, prev.id AS supersedes`;

export const memoryVersions = defineQuery<VersionRow>({
  name: 'view.memory.versions',
  description: 'Every version of every memory key, with its writer and the version it superseded.',
  mode: 'read',
  cypher: `MATCH (e:Episode)-[:WROTE]->(m:MemoryItem)
           OPTIONAL MATCH (m)-[:SUPERSEDES]->(prev:MemoryItem)
           RETURN ${VERSION_FIELDS}
           ORDER BY ns, key, validFrom`,
});

export const memorySearch = defineQuery<VersionRow>({
  name: 'view.memory.search',
  description: 'Full-text search over memory text; returns every version of each matching key.',
  mode: 'read',
  cypher: `CALL db.idx.fulltext.queryNodes('MemoryItem', $q) YIELD node
           WITH DISTINCT node.ns AS ns, node.key AS key
           MATCH (e:Episode)-[:WROTE]->(m:MemoryItem {ns: ns, key: key})
           OPTIONAL MATCH (m)-[:SUPERSEDES]->(prev:MemoryItem)
           RETURN ${VERSION_FIELDS}
           ORDER BY ns, key, validFrom`,
});
