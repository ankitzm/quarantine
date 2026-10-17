import { defineQuery } from './types.ts';

// LangGraph store reads only ever see current, non-invalidated versions: a poisoned version stops being
// served the moment quarantine invalidates it, even before anything is restored.

export interface StoreRow {
  id: string;
  ns: string;
  key: string;
  text: string;
  value: string | null;
  createdAt: number;
  updatedAt: number;
  score: number | null;
}

const CURRENT = 'm.valid_to IS NULL AND NOT coalesce(m.invalidated, false)';
const FIELDS = `m.id AS id, m.ns AS ns, m.key AS key, m.text AS text, m.value AS value,
                createdAt, m.valid_from AS updatedAt`;
// createdAt is when the key first appeared: the oldest version under the same (ns, key).
const CREATED = `OPTIONAL MATCH (o:MemoryItem {ns: m.ns, key: m.key})`;

export const storeGet = defineQuery<StoreRow>({
  name: 'store.get',
  description: 'Current version of one key.',
  mode: 'read',
  cypher: `MATCH (m:MemoryItem {ns: $ns, key: $key}) WHERE ${CURRENT}
           ${CREATED}
           WITH m, min(o.valid_from) AS createdAt
           RETURN ${FIELDS}, null AS score`,
});

export const storeList = defineQuery<StoreRow>({
  name: 'store.list',
  description: 'Current versions under a namespace prefix.',
  mode: 'read',
  cypher: `MATCH (m:MemoryItem) WHERE (m.ns = $prefix OR m.ns STARTS WITH $prefix + '/' OR $prefix = '')
             AND ${CURRENT}
           ${CREATED}
           WITH m, min(o.valid_from) AS createdAt
           RETURN ${FIELDS}, null AS score
           ORDER BY updatedAt DESC, id`,
});

export const storeSearch = defineQuery<StoreRow>({
  name: 'store.search',
  description: 'Full-text search over current versions under a namespace prefix.',
  mode: 'read',
  cypher: `CALL db.idx.fulltext.queryNodes('MemoryItem', $query) YIELD node AS m, score
           WHERE (m.ns = $prefix OR m.ns STARTS WITH $prefix + '/' OR $prefix = '') AND ${CURRENT}
           ${CREATED}
           WITH m, score, min(o.valid_from) AS createdAt
           RETURN ${FIELDS}, score
           ORDER BY score DESC, id`,
});

export const storeNamespaces = defineQuery<{ ns: string }>({
  name: 'store.namespaces',
  description: 'Distinct namespaces holding a current version.',
  mode: 'read',
  cypher: `MATCH (m:MemoryItem) WHERE ${CURRENT} RETURN DISTINCT m.ns AS ns ORDER BY ns`,
});
