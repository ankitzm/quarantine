import { EventEmitter } from 'node:events';
import { getDb } from './client.ts';
import { GraphNotReady, QueryTimeout } from './errors.ts';
import type { Query, QueryMode } from './queries/types.ts';

export type Params = Record<string, unknown>;

export interface QueryLogEntry {
  seq: number;
  at: number;
  graph: string;
  name: string;
  mode: QueryMode;
  cypher: string;
  params: Params;
  ms: number;
  rows: number;
  error?: string;
}

export const DEFAULT_TIMEOUT_MS = 5_000;
const LOG_SIZE = 200;

const log: QueryLogEntry[] = [];
let seq = 0;

/** Emits `query` with a {@link QueryLogEntry} after every statement, successful or not. */
export const queryEvents = new EventEmitter<{ query: [QueryLogEntry] }>();

/** Most recent statements, oldest first. Params are already redacted. */
export function queryLog(limit = LOG_SIZE): QueryLogEntry[] {
  return log.slice(-limit);
}

/**
 * The only path to the database. Reads go through GRAPH.RO_QUERY so a registered read can never mutate,
 * every statement carries a TIMEOUT, and every call lands in the query log.
 */
export async function run<Row>(
  graph: string,
  query: Query<Row>,
  params: Params = {},
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<Row[]> {
  const g = (await getDb()).selectGraph(graph);
  const options = { params: params as never, TIMEOUT: timeoutMs };
  const started = performance.now();
  let rows: Row[] = [];
  let error: string | undefined;
  try {
    const reply =
      query.mode === 'read'
        ? await g.roQuery<Row>(query.cypher, options)
        : await g.query<Row>(query.cypher, options);
    rows = reply.data ?? [];
    return rows;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    if (/empty key/i.test(error)) throw new GraphNotReady(graph);
    if (/timed out/i.test(error)) throw new QueryTimeout(query.name, timeoutMs);
    throw e;
  } finally {
    record({
      seq: ++seq,
      at: Date.now(),
      graph,
      name: query.name,
      mode: query.mode,
      cypher: query.cypher,
      params: redact(params) as Params,
      ms: Math.round((performance.now() - started) * 100) / 100,
      rows: rows.length,
      ...(error === undefined ? {} : { error }),
    });
  }
}

function record(entry: QueryLogEntry): void {
  log.push(entry);
  if (log.length > LOG_SIZE) log.shift();
  queryEvents.emit('query', entry);
}

const SECRET_KEY = /pass|secret|token|api.?key|auth|credential.?value/i;
const MAX_STRING = 80;

/** Hides secret-looking keys and truncates long strings so the log never carries payloads or keys. */
export function redact(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length})` : value;
  }
  if (Array.isArray(value)) {
    const head = value.slice(0, 20).map((v) => redact(v));
    return value.length > 20 ? [...head, `…(${value.length})`] : head;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  return value;
}
