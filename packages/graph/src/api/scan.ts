import { randomUUID } from 'node:crypto';
import { getDb } from '../client.ts';
import { applyEvents } from '../ingest.ts';
import { parseMcpConfig } from '../permissions/config.ts';
import { cutReach } from '../permissions/plan.ts';
import { ensureSchema } from '../schema.ts';
import type { ScanRequest, ScanResponse } from '../types/api.ts';

export const SCAN_NOTICE =
  'Env values and secrets in uploaded configs are read only to derive names and are never stored; the scan ' +
  'graph is deleted as soon as the response is built.';

/**
 * What a compromise of the given agents could reach through their MCP configs, and the cheapest cut. Runs
 * in a throwaway graph that is deleted even if the scan fails.
 */
export async function buildScan({ configs, compromised }: ScanRequest): Promise<ScanResponse> {
  const graph = `scan_${randomUUID()}`;
  try {
    await ensureSchema(graph);
    const agents: ScanResponse['agents'] = [];
    for (const [agent, raw] of Object.entries(configs).sort(([a], [b]) => a.localeCompare(b))) {
      const { grants, unknown } = parseMcpConfig('scan', agent, raw, `upload:${agent}.mcp.json`);
      await applyEvents(graph, [{ type: 'PermissionConfig', t: 0, agent, grants }]);
      agents.push({ agent, tools: grants.length, unknownServers: unknown });
    }
    const names = agents.map((a) => a.agent);
    const targets = (compromised ?? names).filter((a) => names.includes(a)).sort();
    return { agents, compromised: targets, ...(await cutReach(graph, targets)), notice: SCAN_NOTICE };
  } finally {
    const db = await getDb();
    if ((await db.list()).includes(graph)) await db.selectGraph(graph).delete();
  }
}
