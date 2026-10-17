import { describe, expect, it } from 'vitest';
import { getDb } from '../client.ts';
import { applyEvents } from '../ingest.ts';
import { queryLog } from '../run.ts';
import { scratchGraph } from '../testing.ts';
import { parseMcpConfig } from './config.ts';

const graph = scratchGraph();
const SENTINEL = 'SENTINEL_9f2c41d7';

const config = {
  mcpServers: {
    stripe: {
      command: 'npx',
      args: ['-y', '@stripe/mcp', '--tools=all'],
      env: { STRIPE_SECRET_KEY: `sk_${SENTINEL}` },
    },
    db: {
      command: 'npx',
      args: [
        '-y',
        '@modelcontextprotocol/server-postgres',
        `postgresql://app:${SENTINEL}@db.internal:5432/crm`,
      ],
    },
    files: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/srv/a', '/home/x/.ssh'],
    },
    mystery: { command: 'node', args: ['in-house-server.js'], env: { TOKEN: SENTINEL } },
  },
};

describe('parseMcpConfig', () => {
  const { grants, unknown } = parseMcpConfig('t', 'billing', config, 'billing.mcp.json');

  it('maps known servers to per-tool grants citing their source', () => {
    expect(grants.map((g) => g.tool.id)).toContain('billing:stripe.create_refund');
    expect(grants.find((g) => g.tool.id === 'billing:postgres.query')?.source).toMatch(
      /^billing\.mcp\.json#\/mcpServers\/db \(https:\/\/github\.com\/modelcontextprotocol\//,
    );
    expect(unknown).toEqual(['mystery']);
  });

  it('derives credentials and resources without secrets', () => {
    const pg = grants.find((g) => g.tool.id === 'billing:postgres.query');
    expect(pg?.credential?.envName).toBe('postgres://app@db.internal:5432/crm');
    expect(pg?.resources.map((r) => [r.uri, r.sensitivity])).toEqual([
      ['postgres://db.internal:5432/crm', 3],
    ]);
    const fs = grants.find((g) => g.tool.id === 'billing:filesystem.read_file');
    expect(fs?.credential).toBeUndefined();
    expect(fs?.resources.map((r) => [r.uri, r.kind])).toEqual([
      ['file:///srv/a', 'files'],
      ['file:///home/x/.ssh', 'secrets'],
    ]);
  });

  it('never lets a secret value reach the graph or the query log', async () => {
    expect(JSON.stringify(grants)).not.toContain(SENTINEL);
    await applyEvents(graph, [{ type: 'PermissionConfig', t: 1, agent: 'billing', grants }]);
    const db = await getDb();
    const dump = await db.selectGraph(graph).roQuery('MATCH (n) OPTIONAL MATCH (n)-[r]->() RETURN n, r');
    expect(JSON.stringify(dump.data)).not.toContain(SENTINEL);
    expect(JSON.stringify(queryLog())).not.toContain(SENTINEL);
  });
});
