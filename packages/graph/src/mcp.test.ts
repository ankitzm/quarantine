import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadFixture, readConfigEvents, readFixture } from './fixtures.ts';
import { createMcpServer } from './mcp.ts';
import { scratchGraph } from './testing.ts';

const graph = scratchGraph();
const client = new Client({ name: 'test', version: '0' });

beforeAll(async () => {
  const fixture = await readFixture('fixtures/runs/acme-attack1.seed.json');
  await loadFixture(graph, fixture, await readConfigEvents('fixtures/configs/acme', 'acme', 0));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(graph).connect(a);
  await client.connect(b);
});

const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { isError: r.isError ?? false, body: r.content[0]?.text ?? '' };
};

describe('MCP server', () => {
  it('lists the tools with read-only hints', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'apply_quarantine',
      'incident_reach',
      'incident_timeline',
      'plan_quarantine',
      'search_memory',
      'trace_incident',
    ]);
    expect(tools.find((t) => t.name === 'trace_incident')?.annotations?.readOnlyHint).toBe(true);
  });

  it('investigates, plans and applies only with confirm', async () => {
    const traced = JSON.parse((await call('trace_incident', { seed: 'acme-mem-sop-v4' })).body);
    expect(traced.trace.agents).toHaveLength(4);
    const plan = JSON.parse((await call('plan_quarantine', { seed: 'acme-mem-sop-v4' })).body);
    expect(await call('apply_quarantine', { plan_id: plan.id, confirm: false })).toEqual({
      isError: true,
      body: 'CONFIRM_REQUIRED: applying a quarantine requires confirm=true',
    });
    const applied = JSON.parse((await call('apply_quarantine', { plan_id: plan.id, confirm: true })).body);
    expect(applied.reachAfter).toEqual([]);
  });

  it('turns failures into tool errors', async () => {
    expect((await call('incident_reach', { seed: 'nope' })).isError).toBe(true);
  });
});
