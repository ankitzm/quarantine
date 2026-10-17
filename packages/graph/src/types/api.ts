import { z } from 'zod';

/**
 * The HTTP contract. Route handlers and `pnpm mocks` both produce these through the pure builders in
 * `src/api`, and every mock is validated against them, so the UI can build against mocks safely.
 *
 * Conventions: camelCase fields, epoch-ms integer times, ids are opaque strings, lists are complete
 * (graphs per tenant are small; paginate when one is not). Additive changes only.
 *
 *   GET  /api/health
 *   GET  /api/incidents/:seed?mode=temporal|naive      IncidentResponse
 *   GET  /api/incidents/:seed/timeline                 TimelineResponse
 *   GET  /api/incidents/:seed/reach                    ReachResponse
 *   POST /api/incidents/:seed/plans                    PlanResponse    (deterministic; safe to retry)
 *   GET  /api/plans/:id                                PlanResponse
 *   POST /api/plans/:id/apply   {confirm: true}        ApplyResponse   (idempotent; safe to retry)
 *   GET  /api/memory?q=                                MemoryResponse
 *   GET  /api/queries                                  QueryLogResponse
 *   GET  /api/queries/stream                           SSE of QueryLogEntry, this visitor's graph only
 *   GET  /api/incidents/:seed/stream?mode=             SSE of TraceStreamEvent: one per round, then done
 *   POST /api/demo/reset                               DemoResetResponse
 *   POST /api/scan                                     ScanResponse
 *   GET  /api/eval                                     EvalResponse
 *
 * Errors, everywhere: `{ error: { code, message } }` with the status in ErrorCode below.
 */

export const ErrorCode = z.enum([
  'VALIDATION_ERROR', // 422
  'GRAPH_NOT_READY', // 503
  'QUERY_TIMEOUT', // 504
  'SEED_NOT_FOUND', // 404
  'PLAN_NOT_FOUND', // 404
  'CONFIRM_REQUIRED', // 400
  'PAYLOAD_TOO_LARGE', // 413
  'RATE_LIMITED', // 429
  'INTERNAL', // 500, message never carries internals
]);
export const ErrorResponse = z.object({ error: z.object({ code: ErrorCode, message: z.string() }) });

const Id = z.string();
const Time = z.number().int();

export const TraceMode = z.enum(['temporal', 'naive']);

export const Cause = z.object({
  edge: z.enum(['SEED', 'WROTE', 'READ', 'HANDED_OFF', 'DERIVED_FROM', 'SAME_KEY']),
  from: Id.nullable(),
});

export const Trace = z.object({
  mode: TraceMode,
  seed: z.object({ item: Id, episode: Id, agent: Id, at: Time }),
  rounds: z.number().int(),
  episodes: z.array(z.object({ id: Id, agent: Id, session: Id, infectedAt: Time, cause: Cause })),
  items: z.array(
    z.object({
      id: Id,
      ns: z.string(),
      key: z.string(),
      kind: z.string(),
      text: z.string(),
      validFrom: Time,
      validTo: Time.nullable(),
      infectedAt: Time,
      cause: Cause,
    }),
  ),
  agents: z.array(z.object({ id: Id, infectedAt: Time })),
  decisions: z.array(
    z.object({
      id: Id,
      t: Time,
      text: z.string(),
      episode: Id,
      agent: Id,
      byAgent: z.boolean(),
      basedOn: z.array(Id),
    }),
  ),
  toolCalls: z.array(
    z.object({
      id: Id,
      t: Time,
      tool: z.string(),
      args: z.string(),
      outcome: z.string(),
      episode: Id,
      agent: Id,
    }),
  ),
});

const IdDiff = z.object({
  episodes: z.array(Id),
  items: z.array(Id),
  decisions: z.array(Id),
  toolCalls: z.array(Id),
});

export const IncidentResponse = z.object({
  tenant: z.string(),
  trace: Trace,
  /** What the naive (time-blind) trace flags that the temporal trace does not: its false positives. */
  naiveFalsePositives: IdDiff,
});

export const TimelineEvent = z.object({
  t: Time,
  kind: z.enum(['input', 'write', 'read', 'handoff', 'decision', 'toolCall']),
  session: Id,
  episode: Id,
  agent: Id,
  /** The node acted on: input, memory version, target episode, decision or tool call. */
  target: Id,
  /** Agent receiving a handoff, tool for a call. */
  targetAgent: Id.nullable(),
  detail: z.string(),
  /** Carries or acts on the infection according to the temporal trace. */
  isInfected: z.boolean(),
  /** Flagged only by the naive trace: a false positive. */
  isNaiveOnly: z.boolean(),
});

export const TimelineResponse = z.object({
  tenant: z.string(),
  seed: Id,
  sessions: z.array(z.object({ id: Id, label: z.string().nullable(), t: Time })),
  events: z.array(TimelineEvent),
});

export const ReachPath = z.object({
  agent: Id,
  tool: Id,
  credential: z.string().nullable(),
  resource: Id,
  uri: z.string(),
  kind: z.string(),
  sensitivity: z.number().int(),
});

export const ReachResponse = z.object({
  tenant: z.string(),
  seed: Id,
  agents: z.array(Id),
  paths: z.array(ReachPath),
  resources: z.array(
    z.object({
      id: Id,
      uri: z.string(),
      kind: z.string(),
      sensitivity: z.number().int(),
      agents: z.array(Id),
    }),
  ),
});

export const Revocation = z.object({
  action: z.enum(['revoke-tool', 'rotate-credential']),
  from: Id,
  to: Id,
  label: z.string(),
  cost: z.number().int(),
  source: z.string().nullable(),
});

export const PlanResponse = z.object({
  tenant: z.string(),
  id: Id,
  seed: Id,
  agents: z.array(Id),
  /** Infected memory versions besides the seed, invalidated on apply. */
  items: z.array(Id),
  reach: z.array(ReachPath),
  maxFlow: z.number().int(),
  totalCost: z.number().int(),
  cut: z.array(Revocation),
  appliedAt: Time.nullable(),
});

export const ApplyRequest = z.object({ confirm: z.boolean().default(false) });

export const ApplyResponse = z.object({
  tenant: z.string(),
  plan: Id,
  revoked: z.number().int(),
  restored: Id.nullable(),
  reachAfter: z.array(ReachPath),
});

export const MemoryVersion = z.object({
  id: Id,
  text: z.string(),
  validFrom: Time,
  validTo: Time.nullable(),
  isInvalidated: z.boolean(),
  writer: z.object({ episode: Id, agent: Id }),
  supersedes: Id.nullable(),
});

export const MemoryResponse = z.object({
  tenant: z.string(),
  query: z.string().nullable(),
  keys: z.array(
    z.object({ ns: z.string(), key: z.string(), kind: z.string(), versions: z.array(MemoryVersion) }),
  ),
});

export const QueryLogEntry = z.object({
  seq: z.number().int(),
  at: Time,
  graph: z.string(),
  name: z.string(),
  mode: z.enum(['read', 'write']),
  cypher: z.string(),
  params: z.record(z.string(), z.unknown()),
  ms: z.number(),
  rows: z.number().int(),
  error: z.string().optional(),
});

const Infected = z.object({ id: Id, infectedAt: Time, cause: Cause });

/** Trace stream: the infection spreading round by round, for animation, then the full incident. */
export const TraceStreamEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('round'),
    round: z.number().int(),
    episodes: z.array(Infected),
    items: z.array(Infected),
  }),
  z.object({ type: z.literal('done'), incident: IncidentResponse }),
  z.object({ type: z.literal('error'), error: ErrorResponse.shape.error }),
]);

export const DemoResetResponse = z.object({ tenant: z.string(), resetAt: Time });

/** Configs keyed by agent name, each a Claude Desktop / Cursor style `{ mcpServers: {...} }` object. */
export const ScanRequest = z.object({
  configs: z
    .record(z.string().regex(/^[a-z0-9_-]{1,40}$/i), z.unknown())
    .refine((c) => Object.keys(c).length > 0 && Object.keys(c).length <= 20, 'between 1 and 20 agents'),
  /** Agents to treat as compromised. Defaults to all of them. */
  compromised: z.array(z.string()).max(20).optional(),
});

export const ScanResponse = z.object({
  agents: z.array(
    z.object({ agent: z.string(), tools: z.number().int(), unknownServers: z.array(z.string()) }),
  ),
  compromised: z.array(z.string()),
  reach: z.array(ReachPath),
  maxFlow: z.number().int(),
  totalCost: z.number().int(),
  cut: z.array(Revocation),
  notice: z.string(),
});

export const QueryLogResponse = z.object({ entries: z.array(QueryLogEntry) });

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  engine: z.object({ reachable: z.boolean() }),
  tenants: z.array(z.object({ tenant: z.string(), isReady: z.boolean() })),
  latencyMs: z.number().int(),
});

export const EvalResponse = z.object({
  status: z.enum(['pending', 'complete']),
  generatedAt: Time.nullable(),
  results: z.unknown(),
});

export type ErrorResponse = z.infer<typeof ErrorResponse>;
export type IncidentResponse = z.infer<typeof IncidentResponse>;
export type TimelineEvent = z.infer<typeof TimelineEvent>;
export type TimelineResponse = z.infer<typeof TimelineResponse>;
export type ReachResponse = z.infer<typeof ReachResponse>;
export type PlanResponse = z.infer<typeof PlanResponse>;
export type ApplyResponse = z.infer<typeof ApplyResponse>;
export type MemoryResponse = z.infer<typeof MemoryResponse>;
export type QueryLogResponse = z.infer<typeof QueryLogResponse>;
export type HealthResponse = z.infer<typeof HealthResponse>;
export type EvalResponse = z.infer<typeof EvalResponse>;
export type TraceStreamEvent = z.infer<typeof TraceStreamEvent>;
export type ScanRequest = z.infer<typeof ScanRequest>;
export type ScanResponse = z.infer<typeof ScanResponse>;
