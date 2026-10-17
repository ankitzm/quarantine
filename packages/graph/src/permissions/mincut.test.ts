import { describe, expect, it } from 'vitest';
import type { NetworkEdge } from '../queries/permissions.ts';
import { exhaustiveMinCost, InvalidCut, minCut } from './mincut.ts';

let next = 0;
const edge = (type: string, from: number, to: number, capacity: number, revocable = true): NetworkEdge => ({
  id: next++,
  type,
  from,
  to,
  fromKey: `N:${from}`,
  toKey: `N:${to}`,
  fromName: String(from),
  toName: String(to),
  capacity,
  cost: capacity,
  revocable,
  source: null,
});

// Two agents (1, 2) share a credential (4) behind their own tools (10, 20); agent 2 also has egress (30).
const INF = 1_000_000;
const net = [
  edge('CAN_USE', 1, 10, 5),
  edge('CAN_USE', 2, 20, 5),
  edge('USES_CRED', 10, 4, INF, false),
  edge('USES_CRED', 20, 4, INF, false),
  edge('CRED_CUT', 4, 40, 6),
  edge('GRANTS', 40, 100, INF, false),
  edge('CAN_USE', 2, 30, 2),
  edge('ACTS_ON', 30, 101, INF, false),
];

describe('minCut', () => {
  it('prefers one shared rotation over two tool revocations', () => {
    const flows = [3, 3, 3, 3, 6, 6, 2, 2];
    const flow = new Map(net.map((e, i) => [e.id, flows[i] ?? 0]));
    const cut = minCut(net, flow, 8);
    expect(cut.map((e) => e.type).sort()).toEqual(['CAN_USE', 'CRED_CUT']);
    expect(exhaustiveMinCost(net, new Set([100, 101]))).toBe(8);
  });

  it('rejects a cut whose capacity does not match the flow', () => {
    expect(() => minCut(net, new Map(), 8)).toThrow(InvalidCut);
  });

  it('rejects a cut through a non-revocable edge', () => {
    const bad = [edge('CAN_USE', 1, 2, 5), edge('ACTS_ON', 2, 3, 2, false)];
    expect(() => minCut(bad, new Map(bad.map((e) => [e.id, 2])), 2)).toThrow(/non-revocable/);
  });
});
