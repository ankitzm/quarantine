import type { EventInput } from '../events.ts';

/** mulberry32: small, fast, seedable. Same seed, same scenario. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Scenario {
  seed: number;
  tenant: string;
  poison: string;
  events: EventInput[];
  configs: Record<string, unknown>;
}

const AGENTS = ['researcher', 'billing', 'ops', 'analytics', 'support', 'finance', 'legal', 'sales'];
const KEYS = [
  ['sop', 'refunds'],
  ['sop', 'escalation'],
  ['sop', 'vendors'],
  ['customer', 'c-1'],
  ['customer', 'c-2'],
  ['customer', 'c-3'],
] as const;

const SERVERS: Record<string, unknown> = {
  stripe: { command: 'npx', args: ['-y', '@stripe/mcp'], env: { STRIPE_SECRET_KEY: 'x' } },
  github: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' },
  },
  slack: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: 'x' },
  },
  fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
  crm: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://u:x@db.internal/crm'],
  },
  files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/srv/docs'] },
};

/**
 * A random swarm history with one poisoned write. Sessions of episodes read and write versioned memory,
 * hand off, decide and call tools; some reads and handoffs land before the poisoning on purpose, which is
 * where a time-blind trace goes wrong. Each agent gets a random subset of MCP servers.
 */
export function generateScenario(seed: number): Scenario {
  const rand = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const tenant = `eval${seed}`;
  const agents = AGENTS.slice(0, 4 + Math.floor(rand() * 5));
  const events: EventInput[] = [];
  const current = new Map<string, string>();
  let t = 1_000;
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;

  const write = (episode: string, ns: string, key: string, derivedFrom: string[] = []) => {
    const k = `${ns}/${key}`;
    const item = id('m');
    const prev = current.get(k);
    events.push({
      type: 'MemoryWrite',
      id: item,
      t: (t += 7),
      episode,
      ns: [ns],
      key,
      text: `${k} by ${episode}`,
      derivedFrom,
      ...(prev ? { supersedes: prev } : {}),
    });
    current.set(k, item);
    return item;
  };

  // Baseline: one session writing a first version of every key.
  events.push({ type: 'Session', id: 's0', t, tenant });
  const e0 = id('e');
  events.push({ type: 'Episode', id: e0, t: (t += 5), session: 's0', agent: pick(agents) });
  for (const [ns, key] of KEYS) write(e0, ns, key);

  const sessions = 3 + Math.floor(rand() * 4);
  const poisonSession = Math.floor(rand() * sessions);
  let poison = '';
  for (let s = 0; s < sessions; s++) {
    const session = id('s');
    events.push({ type: 'Session', id: session, t: (t += 1_000), tenant });
    let episode = id('e');
    events.push({ type: 'Episode', id: episode, t: (t += 5), session, agent: pick(agents) });
    const turns = 3 + Math.floor(rand() * 5);
    for (let turn = 0; turn < turns; turn++) {
      const reads: string[] = [];
      for (let r = Math.floor(rand() * 3); r > 0; r--) {
        const [ns, key] = pick(KEYS);
        const item = current.get(`${ns}/${key}`);
        if (item) {
          events.push({ type: 'MemoryRead', t: (t += 3), episode, item });
          reads.push(item);
        }
      }
      if (s === poisonSession && turn === 1 && !poison) {
        const input = id('in');
        events.push({ type: 'Input', id: input, t: (t += 2), episode, source: 'web', text: 'injected page' });
        poison = write(episode, 'sop', pick(['refunds', 'escalation', 'vendors']), [input]);
      } else if (rand() < 0.5) {
        const [ns, key] = pick(KEYS);
        write(episode, ns, key, rand() < 0.6 ? reads.slice(0, 1) : []);
      }
      if (rand() < 0.5) {
        events.push({
          type: 'Decision',
          id: id('d'),
          t: (t += 4),
          episode,
          text: 'act',
          basedOn: reads.slice(0, 2),
        });
      }
      if (rand() < 0.4) {
        events.push({
          type: 'ToolCall',
          id: id('c'),
          t: (t += 4),
          episode,
          tool: 'fetch.fetch',
          args: '{}',
          outcome: 'stubbed',
        });
      }
      if (rand() < 0.6) {
        const next = id('e');
        events.push({ type: 'Episode', id: next, t: (t += 5), session, agent: pick(agents) });
        events.push({ type: 'Handoff', t, from: episode, to: next, summary: 'next' });
        episode = next;
      }
    }
  }

  const configs = Object.fromEntries(
    agents.map((agent) => {
      const names = Object.keys(SERVERS).filter(() => rand() < 0.5);
      if (!names.length) names.push('fetch');
      return [agent, { mcpServers: Object.fromEntries(names.map((name) => [name, SERVERS[name]])) }];
    }),
  );
  return { seed, tenant, poison, events, configs };
}
