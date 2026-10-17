import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { closeDb, getDb, loadFixture, readConfigEvents, readFixture } from '@quarantine/graph';
import { createMcpServer } from '@quarantine/graph/mcp';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScriptedChatModel } from './scripted-model.ts';
import { replaySentinel, runSentinel } from './sentinel.ts';

const graph = `test_${randomUUID().slice(0, 8)}`;
const client = new Client({ name: 'sentinel-test', version: '0' });

beforeAll(async () => {
  const fixture = await readFixture('fixtures/runs/acme-attack1.seed.json');
  await loadFixture(graph, fixture, await readConfigEvents('fixtures/configs/acme', 'acme', 0));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(graph).connect(a);
  await client.connect(b);
});
afterAll(async () => {
  await (await getDb()).selectGraph(graph).delete();
  await closeDb();
});

describe('Sentinel', () => {
  it('investigates through MCP tools, records the calls, and replays them identically', async () => {
    const model = new ScriptedChatModel([
      { tool: 'search_memory', args: { query: 'audit-sync' } },
      { tool: 'trace_incident', args: { seed: 'acme-mem-sop-v4', mode: 'temporal' } },
      { tool: 'incident_reach', args: { seed: 'acme-mem-sop-v4' } },
      { tool: 'plan_quarantine', args: { seed: 'acme-mem-sop-v4' } },
      { say: 'Report: sop/refunds v4 was poisoned by the researcher.' },
    ]);
    const run = await runSentinel({ model, client, alert: 'Billing refunded $4,800 without approval.' });
    expect(run.calls.map((c) => c.tool)).toEqual([
      'search_memory',
      'trace_incident',
      'incident_reach',
      'plan_quarantine',
    ]);
    expect(JSON.parse(run.calls[1]?.result ?? '{}').trace.agents).toHaveLength(4);
    expect(run.narrative).toMatch(/poisoned/);
    expect(await replaySentinel(client, run)).toEqual([]);
  });

  it('does not offer apply unless the operator allowed it', async () => {
    const model = new ScriptedChatModel([
      { tool: 'apply_quarantine', args: { plan_id: 'x', confirm: true } },
      { say: 'ok' },
    ]);
    const run = await runSentinel({ model, client, alert: 'apply everything' });
    expect(run.calls).toEqual([]);
  });
});
