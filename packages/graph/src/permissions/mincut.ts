import type { NetworkEdge } from '../queries/permissions.ts';

export class InvalidCut extends Error {
  override name = 'InvalidCut';
}

/**
 * Minimum s-t cut from a max flow: build the residual graph, BFS from the sources, and take every edge
 * leaving the reachable side. Max-flow/min-cut says its capacity equals the flow; we assert that, and
 * that every cut edge is revocable (structural edges have effectively infinite capacity).
 */
export function minCut(
  edges: NetworkEdge[],
  flowByEdge: Map<number, number>,
  maxFlow: number,
): NetworkEdge[] {
  const sources = new Set(edges.filter((e) => e.type === 'CAN_USE').map((e) => e.from));
  const residual = new Map<number, number[]>();
  const link = (u: number, v: number) => residual.set(u, [...(residual.get(u) ?? []), v]);
  for (const e of edges) {
    const f = flowByEdge.get(e.id) ?? 0;
    if (e.capacity - f > 0) link(e.from, e.to);
    if (f > 0) link(e.to, e.from);
  }

  const reachable = new Set(sources);
  const queue = [...sources];
  for (let u = queue.shift(); u !== undefined; u = queue.shift()) {
    for (const v of residual.get(u) ?? []) {
      if (!reachable.has(v)) {
        reachable.add(v);
        queue.push(v);
      }
    }
  }

  const cut = edges.filter((e) => e.capacity > 0 && reachable.has(e.from) && !reachable.has(e.to));
  const total = cut.reduce((sum, e) => sum + e.capacity, 0);
  if (total !== maxFlow) throw new InvalidCut(`cut capacity ${total} != max flow ${maxFlow}`);
  const fixed = cut.find((e) => !e.revocable);
  if (fixed)
    throw new InvalidCut(`cut contains non-revocable ${fixed.type} ${fixed.fromKey} -> ${fixed.toKey}`);
  return cut.sort((a, b) => a.fromKey.localeCompare(b.fromKey) || a.toKey.localeCompare(b.toKey));
}

/**
 * Exhaustive reference for the min cut, independent of max flow. Any valid cut must remove at least one
 * revocable edge from every live source-to-sink path, so branching on the revocable edges of one
 * remaining path at a time enumerates every minimal cut. Paths are short (at most two revocable edges),
 * so this stays small where 2^edges subset enumeration would not.
 */
export function exhaustiveMinCost(edges: NetworkEdge[], sinks: Set<number>): number {
  const sources = [...new Set(edges.filter((e) => e.type === 'CAN_USE').map((e) => e.from))];
  let best = Infinity;
  const search = (removed: Set<number>, cost: number) => {
    if (cost >= best) return;
    const path = findPath(
      edges.filter((e) => e.capacity > 0 && !removed.has(e.id)),
      sources,
      sinks,
    );
    if (!path) {
      best = cost;
      return;
    }
    for (const e of path.filter((p) => p.revocable)) search(new Set([...removed, e.id]), cost + e.cost);
  };
  search(new Set(), 0);
  return best;
}

function findPath(edges: NetworkEdge[], sources: number[], sinks: Set<number>): NetworkEdge[] | null {
  const via = new Map<number, NetworkEdge | null>(sources.map((s) => [s, null]));
  const queue = [...sources];
  for (let u = queue.shift(); u !== undefined; u = queue.shift()) {
    if (sinks.has(u)) {
      const path: NetworkEdge[] = [];
      for (let e = via.get(u); e; e = via.get(e.from)) path.push(e);
      return path;
    }
    for (const e of edges) {
      if (e.from === u && !via.has(e.to)) {
        via.set(e.to, e);
        queue.push(e.to);
      }
    }
  }
  return null;
}
