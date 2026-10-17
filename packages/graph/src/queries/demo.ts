import { defineQuery } from './types.ts';

export const stampCopy = defineQuery<{ n: number }>({
  name: 'demo.stampCopy',
  description: 'Record when a visitor copy was made, for the sweep.',
  mode: 'write',
  cypher: `MATCH (m:Meta {id: 'meta'}) SET m.copied_at = $now RETURN count(m) AS n`,
});

export const copiedAt = defineQuery<{ at: number | null }>({
  name: 'demo.copiedAt',
  description: 'When a visitor copy was made.',
  mode: 'read',
  cypher: `OPTIONAL MATCH (m:Meta {id: 'meta'}) RETURN m.copied_at AS at`,
});
