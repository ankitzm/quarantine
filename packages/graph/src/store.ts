import {
  BaseStore,
  type GetOperation,
  type Item,
  type ListNamespacesOperation,
  type Operation,
  type OperationResults,
  type PutOperation,
  type SearchItem,
  type SearchOperation,
} from '@langchain/langgraph-checkpoint';
import { stableId, type EventInput } from './events.ts';
import { applyEvents } from './ingest.ts';
import * as q from './queries/store.ts';
import { run } from './run.ts';

/** Who is acting: every put becomes a WROTE by this episode, every get/search a READ. */
export interface Actor {
  episodeId: string;
  /** Inputs the episode has seen; puts are recorded as DERIVED_FROM them (provenance). */
  inputIds?: string[];
}

export interface StoreOptions {
  now?: () => number;
  /** Receives every event the store applies, e.g. the live recorder's run file. */
  onEvent?: (event: EventInput) => void;
}

const SEP = '/';

/**
 * LangGraph BaseStore over FalkorDB with bitemporal versions. A put never overwrites: it writes a new
 * version that SUPERSEDES the current one. Delete closes the current version. Reads only see current,
 * non-invalidated versions. Every change goes through applyEvents, so live runs produce the same graph
 * as replaying their event log.
 *
 * Unattributed stores (no actor) can read but not write; call `as(actor)` per agent turn.
 */
export class FalkorDBStore extends BaseStore {
  constructor(
    readonly graph: string,
    private readonly options: StoreOptions = {},
    private readonly actor: Actor | null = null,
  ) {
    super();
  }

  as(actor: Actor): FalkorDBStore {
    return new FalkorDBStore(this.graph, this.options, actor);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async emit(events: EventInput[]): Promise<void> {
    if (!events.length) return;
    await applyEvents(this.graph, events);
    for (const e of events) this.options.onEvent?.(e);
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: unknown[] = [];
    // Sequential on purpose: a put followed by a get in one batch must see the put.
    for (const op of operations) {
      if ('value' in op) results.push(await this.putOp(op));
      else if ('namespacePrefix' in op) results.push(await this.searchOp(op));
      else if ('key' in op) results.push(await this.getOp(op));
      else results.push(await this.listOp(op));
    }
    return results as OperationResults<Op>;
  }

  private async getOp({ namespace, key }: GetOperation): Promise<Item | null> {
    const [row] = await run(this.graph, q.storeGet, { ns: namespace.join(SEP), key });
    if (!row) return null;
    await this.recordReads([row.id]);
    return toItem(row);
  }

  private async searchOp({
    namespacePrefix,
    query,
    filter,
    limit = 10,
    offset = 0,
  }: SearchOperation): Promise<SearchItem[]> {
    const prefix = namespacePrefix.join(SEP);
    const rows = query?.trim()
      ? await run(this.graph, q.storeSearch, { prefix, query })
      : await run(this.graph, q.storeList, { prefix });
    // ponytail: filter runs in TS after fetching every match; push equality filters into Cypher if stores grow.
    const page = rows
      .map((r) => ({ row: r, item: toItem(r) }))
      .filter(({ item }) => matches(item.value, filter))
      .slice(offset, offset + limit);
    await this.recordReads(page.map(({ row }) => row.id));
    return page.map(({ row, item }) => (row.score === null ? item : { ...item, score: row.score }));
  }

  private async putOp({ namespace, key, value }: PutOperation): Promise<void> {
    if (!this.actor) throw new Error('FalkorDBStore: writes need an actor; use store.as({ episodeId })');
    const { episodeId, inputIds = [] } = this.actor;
    const ns = namespace.join(SEP);
    const [current] = await run(this.graph, q.storeGet, { ns, key });
    const t = this.now();
    if (value === null) {
      if (current) await this.emit([{ type: 'MemoryDelete', t, episode: episodeId, item: current.id }]);
      return;
    }
    const json = JSON.stringify(value);
    await this.emit([
      {
        type: 'MemoryWrite',
        id: stableId('mem', ns, key, t, json),
        t,
        episode: episodeId,
        ns: namespace,
        key,
        text: typeof value.text === 'string' ? value.text : json,
        value: json,
        derivedFrom: inputIds,
        ...(current ? { supersedes: current.id } : {}),
      },
    ]);
  }

  private async listOp({
    matchConditions = [],
    maxDepth,
    limit,
    offset,
  }: ListNamespacesOperation): Promise<string[][]> {
    const all = (await run(this.graph, q.storeNamespaces)).map((r) => r.ns.split(SEP));
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const ns of all) {
      if (!matchConditions.every((c) => matchesPath(ns, c.path, c.matchType))) continue;
      const cut = maxDepth === undefined ? ns : ns.slice(0, maxDepth);
      const k = cut.join(SEP);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(cut);
      }
    }
    return out.slice(offset, offset + limit);
  }

  private async recordReads(itemIds: string[]): Promise<void> {
    if (!this.actor || !itemIds.length) return;
    const t = this.now();
    const episode = this.actor.episodeId;
    await this.emit(itemIds.map((item) => ({ type: 'MemoryRead' as const, t, episode, item })));
  }
}

function toItem(r: q.StoreRow): Item {
  return {
    namespace: r.ns.split(SEP),
    key: r.key,
    value: r.value ? (JSON.parse(r.value) as Record<string, unknown>) : { text: r.text },
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

function matches(value: Record<string, unknown>, filter: Record<string, unknown> | undefined): boolean {
  return !filter || Object.entries(filter).every(([k, v]) => JSON.stringify(value[k]) === JSON.stringify(v));
}

function matchesPath(ns: string[], path: string[], type: 'prefix' | 'suffix'): boolean {
  if (path.length > ns.length) return false;
  const part = type === 'prefix' ? ns.slice(0, path.length) : ns.slice(ns.length - path.length);
  return path.every((p, i) => p === '*' || p === part[i]);
}
