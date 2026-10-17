import { defineQuery } from './types.ts';

export const LABELS = [
  'Session',
  'Agent',
  'Episode',
  'Input',
  'MemoryItem',
  'Decision',
  'ToolCall',
  'Tool',
  'Credential',
  'CredCut',
  'Resource',
  'Plan',
  'Meta',
] as const;

export const idIndexes = LABELS.map((label) =>
  defineQuery({
    name: `schema.index.${label}`,
    description: `Range index on ${label}.id; every writer MERGEs on it.`,
    mode: 'write',
    cypher: `CREATE INDEX FOR (n:${label}) ON (n.id)`,
  }),
);

export const memoryKeyIndex = defineQuery({
  name: 'schema.index.MemoryItem.nsKey',
  description: 'Range index for current-version lookups by (ns, key).',
  mode: 'write',
  cypher: 'CREATE INDEX FOR (m:MemoryItem) ON (m.ns, m.key)',
});

export const memoryTextIndex = defineQuery({
  name: 'schema.fulltext.MemoryItem',
  description: 'Full-text index over memory text for store search and the memory explorer.',
  mode: 'write',
  cypher: 'CREATE FULLTEXT INDEX FOR (m:MemoryItem) ON (m.text)',
});

export const markReady = defineQuery({
  name: 'meta.markReady',
  description: 'Flag the graph as fully loaded. Readers refuse graphs without it.',
  mode: 'write',
  cypher: `MERGE (m:Meta {id: 'meta'})
           ON CREATE SET m.created_at = $now
           SET m.ready = true, m.tenant = $tenant, m.ready_at = $now`,
});

export const readMeta = defineQuery<{ ready: boolean; tenant: string | null; createdAt: number | null }>({
  name: 'meta.read',
  description: 'Load state of the graph.',
  mode: 'read',
  cypher: `OPTIONAL MATCH (m:Meta {id: 'meta'})
           RETURN coalesce(m.ready, false) AS ready, m.tenant AS tenant, m.created_at AS createdAt`,
});
