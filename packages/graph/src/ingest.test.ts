import { describe, expect, it } from 'vitest';
import type { EventInput } from './events.ts';
import { stableId } from './events.ts';
import { applyEvents, IngestError } from './ingest.ts';
import { graphHash } from './inspect.ts';
import { defineQuery } from './queries/types.ts';
import { run } from './run.ts';
import { scratchGraph } from './testing.ts';

const graph = scratchGraph();

const events: EventInput[] = [
  { type: 'Session', id: 's1', t: 0, tenant: 'acme' },
  { type: 'Episode', id: 'e0', t: 2, session: 's1', agent: 'ops' },
  { type: 'Episode', id: 'e1', t: 10, session: 's1', agent: 'researcher' },
  {
    type: 'Input',
    id: 'i1',
    t: 11,
    episode: 'e1',
    source: 'web',
    text: 'new refund policy',
    uri: 'https://x.test',
  },
  { type: 'MemoryWrite', id: 'm1', t: 5, episode: 'e0', ns: ['sop'], key: 'refunds', text: 'real' },
  {
    type: 'MemoryWrite',
    id: 'm2',
    t: 12,
    episode: 'e1',
    ns: ['sop'],
    key: 'refunds',
    text: 'poison',
    derivedFrom: ['i1'],
    supersedes: 'm1',
  },
  { type: 'Episode', id: 'e2', t: 20, session: 's1', agent: 'billing' },
  { type: 'MemoryRead', t: 21, episode: 'e2', item: 'm2' },
  { type: 'Handoff', t: 22, from: 'e1', to: 'e2', summary: 'over to billing' },
  { type: 'Decision', id: 'd1', t: 23, episode: 'e2', text: 'wire refund', basedOn: ['m2'] },
  {
    type: 'ToolCall',
    id: 'c1',
    t: 24,
    episode: 'e2',
    tool: 'stripe.refund',
    args: '{"amount":10}',
    outcome: 'stubbed',
  },
  {
    type: 'PermissionConfig',
    t: 1,
    agent: 'billing',
    grants: [
      {
        tool: { id: 'stripe.refund', name: 'refund', server: 'stripe' },
        cost: 3,
        source: 'billing.mcp.json#mcpServers.stripe',
        credential: { id: 'cred.stripe', envName: 'STRIPE_KEY', rotateCost: 5 },
        resources: [{ id: 'res.payments', uri: 'stripe://payments', kind: 'payments', sensitivity: 3 }],
      },
      {
        tool: { id: 'fetch.get', name: 'fetch', server: 'fetch' },
        cost: 1,
        source: 'billing.mcp.json#mcpServers.fetch',
        resources: [{ id: 'res.web', uri: 'https://*', kind: 'network', sensitivity: 2 }],
      },
    ],
  },
];

const item = defineQuery<{ validTo: number | null; kind: string; ns: string }>({
  name: 'test.item',
  description: 'memory item state',
  mode: 'read',
  cypher: 'MATCH (m:MemoryItem {id: $id}) RETURN m.valid_to AS validTo, m.kind AS kind, m.ns AS ns',
});
const edgeTypes = defineQuery<{ type: string; n: number }>({
  name: 'test.edgeTypes',
  description: 'edge counts',
  mode: 'read',
  cypher: 'MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS n ORDER BY type',
});

describe('applyEvents', () => {
  it('writes the full model and replays to the same graph', async () => {
    expect(await applyEvents(graph, events)).toBe(events.length);
    const first = await graphHash(graph);
    await applyEvents(graph, events);
    expect(await graphHash(graph)).toBe(first);

    expect(await run(graph, item, { id: 'm1' })).toEqual([{ validTo: 12, kind: 'procedural', ns: 'sop' }]);
    expect(await run(graph, item, { id: 'm2' })).toEqual([{ validTo: null, kind: 'procedural', ns: 'sop' }]);
    expect(Object.fromEntries((await run(graph, edgeTypes)).map((r) => [r.type, r.n]))).toEqual({
      ACTS_ON: 1,
      BASED_ON: 1,
      CALLED: 1,
      CAN_USE: 2,
      CRED_CUT: 1,
      DECIDED: 1,
      DERIVED_FROM: 1,
      GRANTS: 1,
      HANDED_OFF: 1,
      IN_SESSION: 3,
      OF: 1,
      RAN: 3,
      READ: 1,
      RECEIVED: 1,
      SUPERSEDES: 1,
      USES_CRED: 1,
      WROTE: 2,
    });
  });

  it('rejects dangling references instead of writing nothing', async () => {
    await expect(
      applyEvents(graph, [{ type: 'MemoryRead', t: 30, episode: 'e2', item: 'nope' }]),
    ).rejects.toBeInstanceOf(IngestError);
  });

  it('rejects malformed events before touching the graph', async () => {
    await expect(applyEvents(graph, [{ type: 'Session', id: '', t: -1, tenant: 'x' }])).rejects.toThrow();
  });
});

describe('stableId', () => {
  it('is deterministic and prefixed', () => {
    expect(stableId('mem', 'sop', 'refunds', 1)).toBe(stableId('mem', 'sop', 'refunds', 1));
    expect(stableId('mem', 'a', 'b')).not.toBe(stableId('mem', 'ab'));
    expect(stableId('mem', 'x')).toMatch(/^mem_[0-9a-f]{16}$/);
  });
});
