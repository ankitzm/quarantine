import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * The event log is the system of record. Live recording, replay, seed fixtures, the eval generator and
 * /api/scan all produce these, and `applyEvents` is the only thing that turns them into graph writes.
 * Times are integer epoch milliseconds.
 */

const Id = z.string().min(1).max(200);
const T = z.number().int().nonnegative();
const Text = z.string().max(20_000);

/** Capacity used for edges that are structural, not revocable. Any min cut containing one is invalid. */
export const INFINITE_CAPACITY = 1_000_000;

export const SessionEvent = z.object({
  type: z.literal('Session'),
  id: Id,
  t: T,
  tenant: Id,
  label: z.string().max(200).optional(),
});

export const EpisodeEvent = z.object({
  type: z.literal('Episode'),
  id: Id,
  t: T,
  session: Id,
  agent: Id,
});

export const InputEvent = z.object({
  type: z.literal('Input'),
  id: Id,
  t: T,
  episode: Id,
  source: z.enum(['user', 'web', 'tool']),
  text: Text,
  uri: z.string().max(2_000).optional(),
});

/** A new memory version. `supersedes` names the version it replaces under the same (ns, key). */
export const MemoryWriteEvent = z.object({
  type: z.literal('MemoryWrite'),
  id: Id,
  t: T,
  episode: Id,
  ns: z.array(z.string().min(1).max(100)).min(1).max(8),
  key: z.string().min(1).max(200),
  text: Text,
  derivedFrom: z.array(Id).default([]),
  supersedes: Id.optional(),
});

export const MemoryReadEvent = z.object({
  type: z.literal('MemoryRead'),
  t: T,
  episode: Id,
  item: Id,
});

export const HandoffEvent = z.object({
  type: z.literal('Handoff'),
  t: T,
  from: Id,
  to: Id,
  summary: z.string().max(2_000),
});

export const DecisionEvent = z.object({
  type: z.literal('Decision'),
  id: Id,
  t: T,
  episode: Id,
  text: Text,
  basedOn: z.array(Id).default([]),
});

export const ToolCallEvent = z.object({
  type: z.literal('ToolCall'),
  id: Id,
  t: T,
  episode: Id,
  tool: Id,
  args: z.string().max(2_000),
  outcome: z.enum(['ok', 'stubbed', 'denied']),
});

export const Resource = z.object({
  id: Id,
  uri: z.string().max(500),
  kind: z.string().max(50),
  sensitivity: z.number().int().min(0).max(3),
});

/** What one agent may do through one tool. `source` cites where in which config file this came from. */
export const Grant = z.object({
  tool: z.object({ id: Id, name: z.string().max(200), server: z.string().max(200) }),
  cost: z.number().int().positive(),
  source: z.string().max(500),
  credential: z
    .object({ id: Id, envName: z.string().max(200), rotateCost: z.number().int().positive() })
    .optional(),
  resources: z.array(Resource).max(100),
});

export const PermissionConfigEvent = z.object({
  type: z.literal('PermissionConfig'),
  t: T,
  agent: Id,
  grants: z.array(Grant).max(100),
});

export const Event = z.discriminatedUnion('type', [
  SessionEvent,
  EpisodeEvent,
  InputEvent,
  MemoryWriteEvent,
  MemoryReadEvent,
  HandoffEvent,
  DecisionEvent,
  ToolCallEvent,
  PermissionConfigEvent,
]);

export type Event = z.infer<typeof Event>;
export type EventInput = z.input<typeof Event>;
export type Grant = z.infer<typeof Grant>;
export type Resource = z.infer<typeof Resource>;

/** Deterministic id from content, so re-recording the same thing yields the same node. */
export function stableId(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16)}`;
}

export const MEMORY_KINDS = { sop: 'procedural', customer: 'semantic', episodes: 'episodic' } as const;

export function memoryKind(ns: readonly string[]): string {
  return MEMORY_KINDS[ns[0] as keyof typeof MEMORY_KINDS] ?? 'semantic';
}
