import { z } from 'zod';
import { stableId, type Grant } from '../events.ts';
import { MANIFESTS, SENSITIVITY, type ServerConfig } from './manifests.ts';

/** Claude Desktop / Cursor style MCP client config. */
const McpConfig = z.object({
  mcpServers: z.record(
    z.string(),
    z.object({
      command: z.string().default(''),
      args: z.array(z.string()).default([]),
      env: z.record(z.string(), z.string()).default({}),
      url: z.string().optional(),
    }),
  ),
});

export interface ParsedConfig {
  grants: Grant[];
  /** Servers no manifest recognises. Reported, never guessed at. */
  unknown: string[];
}

/**
 * A tool node is one agent's instance of a server tool: two agents with the same server but different
 * credentials must not share a node, or the graph would let one reach through the other's credential.
 */
export const toolId = (agent: string, tool: string) => `${agent}:${tool}`;

/**
 * Turns one agent's MCP config into permission grants. Env values and secret-bearing args are read only to
 * derive names (env var name, postgres user@host/db) and never leave this function.
 */
export function parseMcpConfig(tenant: string, agent: string, raw: unknown, source: string): ParsedConfig {
  const config = McpConfig.parse(raw);
  const grants: Grant[] = [];
  const unknown: string[] = [];

  for (const [name, server] of Object.entries(config.mcpServers)) {
    const cfg: ServerConfig = {
      command: server.command,
      args: server.args,
      envNames: Object.keys(server.env),
    };
    const line = [cfg.command, ...cfg.args, server.url ?? ''].join(' ');
    const manifest = MANIFESTS.find((m) => m.match.test(line));
    if (!manifest) {
      unknown.push(name);
      continue;
    }
    const cred = manifest.credential?.(cfg) ?? null;
    const resources = manifest.resources(cfg).map((r) => ({
      ...r,
      id: stableId('res', tenant, r.uri),
      sensitivity: SENSITIVITY[r.kind] ?? 0,
    }));
    for (const [tool, cost] of Object.entries(manifest.tools)) {
      grants.push({
        tool: { id: toolId(agent, `${manifest.server}.${tool}`), name: tool, server: manifest.server },
        cost,
        source: `${source}#/mcpServers/${name} (${manifest.docs})`,
        ...(cred
          ? {
              credential: {
                id: stableId('cred', tenant, cred.name),
                envName: cred.name,
                rotateCost: cred.rotateCost,
              },
            }
          : {}),
        resources,
      });
    }
  }
  return { grants, unknown };
}
