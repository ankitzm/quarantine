import { defineQuery } from './types.ts';

export const dumpNodes = defineQuery<{ labels: string[]; props: Record<string, unknown> }>({
  name: 'inspect.nodes',
  description: 'Every node with its labels and properties, for graph hashing and debugging.',
  mode: 'read',
  cypher: 'MATCH (n) RETURN labels(n) AS labels, properties(n) AS props',
});

export const dumpEdges = defineQuery<{
  type: string;
  from: string;
  to: string;
  props: Record<string, unknown>;
}>({
  name: 'inspect.edges',
  description: 'Every relationship by endpoint ids, for graph hashing and debugging.',
  mode: 'read',
  cypher: 'MATCH (a)-[r]->(b) RETURN type(r) AS type, a.id AS from, b.id AS to, properties(r) AS props',
});
