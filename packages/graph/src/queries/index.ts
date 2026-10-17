import * as demo from './demo.ts';
import * as ingest from './ingest.ts';
import * as inspect from './inspect.ts';
import * as permissions from './permissions.ts';
import * as schema from './schema.ts';
import * as store from './store.ts';
import * as trace from './trace.ts';
import type { Query } from './types.ts';
import * as views from './views.ts';

const isQuery = (v: unknown): v is Query =>
  typeof v === 'object' && v !== null && 'cypher' in v && 'name' in v && 'mode' in v;

/** Every registered statement, grouped by module, in declaration order. Used to generate the README. */
export const REGISTRY: Record<string, Query[]> = Object.fromEntries(
  Object.entries({ schema, ingest, trace, permissions, store, views, inspect, demo }).map(([group, mod]) => [
    group,
    Object.values(mod).flatMap((v) => (Array.isArray(v) ? v.filter(isQuery) : isQuery(v) ? [v] : [])),
  ]),
);
