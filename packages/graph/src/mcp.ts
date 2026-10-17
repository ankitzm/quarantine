import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  buildApply,
  buildCreatePlan,
  buildIncident,
  buildMemory,
  buildReach,
  buildTimeline,
} from './api/index.ts';
import { QuarantineError } from './errors.ts';

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };

async function respond(fn: () => Promise<unknown>): Promise<Result> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await fn()) }] };
  } catch (e) {
    const message = e instanceof QuarantineError ? `${e.code}: ${e.message}` : 'internal error';
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;

/**
 * Quarantine as MCP tools over one tenant graph. Agents get the same builders the HTTP API uses: no Cypher,
 * no credentials. Everything is read-only except planning (idempotent) and apply, which needs confirm=true.
 */
export function createMcpServer(graph: string): McpServer {
  const server = new McpServer({ name: 'quarantine', version: '0.1.0' });
  const seed = z
    .string()
    .min(1)
    .max(200)
    .describe('Id of the poisoned memory version, e.g. from search_memory');

  server.registerTool(
    'search_memory',
    {
      description:
        'Full-text search over shared agent memory. Returns every version of each matching key, with writer and validity.',
      inputSchema: { query: z.string().max(200).optional() },
      annotations: READ,
    },
    ({ query }) => respond(() => buildMemory(graph, { q: query?.trim() || null })),
  );
  server.registerTool(
    'trace_incident',
    {
      description:
        'Trace a poisoned memory version forward in time: infected agents, episodes, memory, decisions and tool calls, ' +
        'plus what a time-blind trace would wrongly flag.',
      inputSchema: { seed, mode: z.enum(['temporal', 'naive']).default('temporal') },
      annotations: READ,
    },
    ({ seed, mode }) => respond(() => buildIncident(graph, { seed, mode })),
  );
  server.registerTool(
    'incident_timeline',
    {
      description: 'Every agent action in time order, marked infected or naive-only.',
      inputSchema: { seed },
      annotations: READ,
    },
    ({ seed }) => respond(() => buildTimeline(graph, { seed })),
  );
  server.registerTool(
    'incident_reach',
    {
      description:
        'Sensitive resources the infected agents can still reach through their tools and credentials.',
      inputSchema: { seed },
      annotations: READ,
    },
    ({ seed }) => respond(() => buildReach(graph, { seed })),
  );
  server.registerTool(
    'plan_quarantine',
    {
      description:
        'Compute the minimum-cost set of revocations that cuts all infected reach. Deterministic; does not apply anything.',
      inputSchema: { seed },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ seed }) => respond(() => buildCreatePlan(graph, { seed })),
  );
  server.registerTool(
    'apply_quarantine',
    {
      description:
        'Apply a stored plan: revoke its edges, invalidate poisoned memory, restore the clean SOP. Requires confirm=true.',
      inputSchema: { plan_id: z.string().min(1).max(200), confirm: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ plan_id, confirm }) => respond(() => buildApply(graph, { id: plan_id, confirm })),
  );
  return server;
}
