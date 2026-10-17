import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { loadMcpTools } from '@langchain/mcp-adapters';
import type { Client } from '@modelcontextprotocol/client';

export interface SentinelCall {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export interface SentinelRun {
  alert: string;
  calls: SentinelCall[];
  narrative: string;
}

const PROMPT =
  'You are Sentinel, the incident responder for an agent swarm. You only know what the Quarantine tools ' +
  'return; never guess. Given an alert: find the suspicious memory version with search_memory, trace it ' +
  'with trace_incident, check what the infected agents can still reach with incident_reach, and compute ' +
  'a fix with plan_quarantine. Then write a short incident report for a human: what was poisoned and when, ' +
  'who was infected and how (cite the edges), which decisions and tool calls need review, what the naive ' +
  'trace would have wrongly flagged, and the proposed revocations with their total cost. Only call ' +
  'apply_quarantine if the operator explicitly asked you to apply.';

/**
 * The LLM narrates and picks tools; every finding comes from the Quarantine MCP tools. Each call and its
 * result is recorded so the run can be replayed against the graph and checked.
 */
export async function runSentinel({
  model,
  client,
  alert,
  allowApply = false,
  recursionLimit = 30,
}: {
  model: BaseChatModel;
  client: Client;
  alert: string;
  allowApply?: boolean;
  recursionLimit?: number;
}): Promise<SentinelRun> {
  const calls: SentinelCall[] = [];
  const tools = (await loadMcpTools('quarantine', client))
    .filter((t) => allowApply || t.name !== 'apply_quarantine')
    .map((t) => record(t, calls));
  const agent = createReactAgent({ llm: model, tools, prompt: PROMPT });
  const { messages } = await agent.invoke({ messages: [new HumanMessage(alert)] }, { recursionLimit });
  const last = messages.findLast((m) => m instanceof AIMessage && typeof m.content === 'string' && m.content);
  return { alert, calls, narrative: typeof last?.content === 'string' ? last.content : '' };
}

function record(t: StructuredToolInterface, calls: SentinelCall[]) {
  return tool(
    async (args: Record<string, unknown>) => {
      const result = String(await t.invoke(args));
      calls.push({ tool: t.name, args, result });
      return result;
    },
    { name: t.name, description: t.description, schema: t.schema },
  );
}

/**
 * Re-executes a recorded Sentinel run's tool calls against the graph. Returns the calls whose result
 * differs; empty means the graph still answers exactly as it did live.
 */
export async function replaySentinel(client: Client, run: SentinelRun): Promise<SentinelCall[]> {
  const drift: SentinelCall[] = [];
  for (const call of run.calls) {
    const r = (await client.callTool({ name: call.tool, arguments: call.args })) as {
      content: { text?: string }[];
    };
    const result = r.content.map((c) => c.text ?? '').join('');
    if (result !== call.result) drift.push({ ...call, result });
  }
  return drift;
}
