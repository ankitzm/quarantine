import { tool } from '@langchain/core/tools';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { METADATA_KEY_HANDOFF_DESTINATION } from '@langchain/langgraph-swarm';
import { z } from 'zod';
import type { Recorder } from './recorder.ts';
import { sandboxFetch } from './sandbox.ts';

const splitKey = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  return { namespace: parts.slice(0, -1), key: parts.at(-1) ?? '' };
};

/** Shared memory, attributed to the calling agent's active episode. */
export function memoryTools(rec: Recorder, agent: string) {
  return [
    tool(
      async ({ query, namespace }) => {
        const hits = await rec
          .storeFor(agent)
          .search(namespace ? namespace.split('/') : [], { query, limit: 5 });
        return JSON.stringify(
          hits.map((h) => ({ path: [...h.namespace, h.key].join('/'), text: h.value.text })),
        );
      },
      {
        name: 'memory_search',
        description: 'Full-text search of shared team memory. Returns matching entries with their path.',
        schema: z.object({
          query: z.string(),
          namespace: z.string().optional().describe('e.g. "sop" or "customer"'),
        }),
      },
    ),
    tool(
      async ({ path }) => {
        const { namespace, key } = splitKey(path);
        const item = await rec.storeFor(agent).get(namespace, key);
        return item ? String(item.value.text ?? JSON.stringify(item.value)) : `No memory at ${path}.`;
      },
      {
        name: 'memory_get',
        description: 'Read one shared memory entry by path, e.g. "sop/refunds".',
        schema: z.object({ path: z.string() }),
      },
    ),
    tool(
      async ({ path, text }) => {
        const { namespace, key } = splitKey(path);
        if (!namespace.length) return 'Path needs a namespace, e.g. "sop/refunds".';
        await rec.storeFor(agent).put(namespace, key, { text });
        return `Saved ${path}.`;
      },
      {
        name: 'memory_put',
        description: 'Create or replace a shared memory entry, e.g. path "sop/refunds" or "customer/c-981".',
        schema: z.object({ path: z.string(), text: z.string() }),
      },
    ),
  ];
}

export function fetchTool(rec: Recorder, agent: string) {
  return tool(
    async ({ url, method = 'GET', body }) => {
      const result = await sandboxFetch(url, method);
      await rec.toolCall(agent, 'fetch.fetch', { url, method, ...(body ? { body } : {}) }, result.outcome);
      if (result.outcome === 'ok') await rec.input(agent, 'web', result.body, url);
      return result.body;
    },
    {
      name: 'fetch',
      description: 'HTTP request. GET returns the page; POST sends `body` to the URL.',
      schema: z.object({
        url: z.string(),
        method: z.enum(['GET', 'POST']).optional(),
        body: z.string().optional(),
      }),
    },
  );
}

export function refundTool(rec: Recorder, agent: string) {
  return tool(
    async (args) => {
      await rec.toolCall(agent, 'stripe.create_refund', args, 'stubbed');
      return `Refund of ${args.amount_cents} cents on ${args.charge} created (re_sandbox).`;
    },
    {
      name: 'stripe_create_refund',
      description: 'Create a Stripe refund for a charge.',
      schema: z.object({
        charge: z.string(),
        amount_cents: z.number().int(),
        card_last4: z.string().optional(),
      }),
    },
  );
}

export function decisionTool(rec: Recorder, agent: string) {
  return tool(
    async ({ decision, memory_paths = [] }) => {
      const ids = await Promise.all(
        memory_paths.map((p) => {
          const { namespace, key } = splitKey(p);
          return rec.store.currentId(namespace, key);
        }),
      );
      await rec.decision(
        agent,
        decision,
        ids.filter((id): id is string => id !== null),
      );
      return 'Decision recorded.';
    },
    {
      name: 'record_decision',
      description:
        'Record the action you are about to take and the memory entries it relies on. Call before acting.',
      schema: z.object({ decision: z.string(), memory_paths: z.array(z.string()).optional() }),
    },
  );
}

/**
 * Swarm handoff with the same Command semantics as langgraph-swarm's createHandoffTool, plus the summary
 * the next agent sees, which the recorder stores on HANDED_OFF.
 */
export function handoffTool(rec: Recorder, from: string, to: string) {
  const name = `transfer_to_${to}`;
  const handoff = tool(
    async ({ summary }, config) => {
      await rec.handoff(from, to, summary);
      const state = getCurrentTaskInput<{ messages: BaseMessage[] }>();
      const message = new ToolMessage({
        content: `Transferred to ${to}. Handoff note: ${summary}`,
        name,
        tool_call_id: config.toolCall?.id ?? name,
      });
      return new Command({
        goto: to,
        graph: Command.PARENT,
        update: { messages: [...state.messages, message], activeAgent: to },
      });
    },
    {
      name,
      description: `Hand the task to ${to} with a short summary of what they need to do.`,
      schema: z.object({ summary: z.string() }),
    },
  );
  handoff.metadata = { [METADATA_KEY_HANDOFF_DESTINATION]: to };
  return handoff;
}
