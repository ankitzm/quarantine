import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../client.ts';
import { buildScan } from './scan.ts';

afterAll(() => closeDb());

const config = async (agent: string) =>
  JSON.parse(await readFile(`fixtures/configs/acme/${agent}.mcp.json`, 'utf8'));

describe('buildScan', () => {
  it('computes reach and the min cut for the compromised agents, then drops its graph', async () => {
    const before = (await (await getDb()).list()).filter((g) => g.startsWith('scan_'));
    const result = await buildScan({
      configs: { billing: await config('billing'), ops: await config('ops') },
      compromised: ['billing'],
    });
    expect(result.agents.map((a) => a.agent)).toEqual(['billing', 'ops']);
    expect(result.compromised).toEqual(['billing']);
    expect(new Set(result.reach.map((r) => r.agent))).toEqual(new Set(['billing']));
    expect(result.totalCost).toBe(result.maxFlow);
    expect(result.cut.length).toBeGreaterThan(0);
    expect((await (await getDb()).list()).filter((g) => g.startsWith('scan_'))).toEqual(before);
  });

  it('reports unknown servers and keeps no secret values', async () => {
    const result = await buildScan({
      configs: {
        x: { mcpServers: { inhouse: { command: 'node', args: ['srv.js'], env: { TOKEN: 'SENTINEL_77' } } } },
      },
    });
    expect(result.agents).toEqual([{ agent: 'x', tools: 0, unknownServers: ['inhouse'] }]);
    expect(JSON.stringify(result)).not.toContain('SENTINEL_77');
  });
});
