import type { Resource } from '../events.ts';

/**
 * How sensitive a resource kind is (0-3). Reach and the min cut only consider resources at or above
 * {@link SENSITIVE}. Egress counts: an open network path is how poisoned agents exfiltrate.
 */
export const SENSITIVITY: Record<string, number> = {
  payments: 3,
  pii: 3,
  database: 3,
  secrets: 3,
  source: 2,
  egress: 2,
  comms: 2,
  files: 1,
};
export const SENSITIVE = 2;

export interface ServerConfig {
  command: string;
  args: string[];
  /** Env var names only. Values are dropped by the parser before a config ever reaches a manifest. */
  envNames: string[];
}

export interface Manifest {
  server: string;
  /** Where the tool list and auth model come from. */
  docs: string;
  /** Matched against `command args...`. */
  match: RegExp;
  /** Tool name to the disruption cost of revoking one agent's access to it. */
  tools: Record<string, number>;
  /** The credential the server authenticates with, if any, and the cost of rotating it. */
  credential?: (cfg: ServerConfig) => { name: string; rotateCost: number } | null;
  resources: (cfg: ServerConfig) => Omit<Resource, 'id' | 'sensitivity'>[];
}

const envCredential =
  (env: string, rotateCost: number) =>
  (cfg: ServerConfig): { name: string; rotateCost: number } | null =>
    cfg.envNames.includes(env) ? { name: env, rotateCost } : null;

export const MANIFESTS: Manifest[] = [
  {
    server: 'stripe',
    docs: 'https://github.com/stripe/agent-toolkit/tree/main/modelcontextprotocol',
    match: /@stripe\/mcp/,
    tools: { create_refund: 5, list_customers: 2, create_customer: 3, retrieve_balance: 1 },
    credential: envCredential('STRIPE_SECRET_KEY', 8),
    resources: () => [
      { uri: 'stripe://payments', kind: 'payments' },
      { uri: 'stripe://customers', kind: 'pii' },
    ],
  },
  {
    server: 'postgres',
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres',
    match: /@modelcontextprotocol\/server-postgres/,
    tools: { query: 4 },
    // The connection string (an argument, not env) is the credential. Only user@host/db is kept.
    credential: (cfg) => {
      const url = postgresUrl(cfg);
      return url ? { name: `postgres://${url.username}@${url.host}${url.pathname}`, rotateCost: 6 } : null;
    },
    resources: (cfg) => {
      const url = postgresUrl(cfg);
      return url ? [{ uri: `postgres://${url.host}${url.pathname}`, kind: 'database' }] : [];
    },
  },
  {
    server: 'github',
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/github',
    match: /@modelcontextprotocol\/server-github/,
    tools: { get_file_contents: 1, create_issue: 2, create_pull_request: 3, push_files: 3 },
    credential: envCredential('GITHUB_PERSONAL_ACCESS_TOKEN', 4),
    resources: () => [{ uri: 'github://repos', kind: 'source' }],
  },
  {
    server: 'slack',
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/slack',
    match: /@modelcontextprotocol\/server-slack/,
    tools: { slack_post_message: 2, slack_list_channels: 1, slack_get_channel_history: 2 },
    credential: envCredential('SLACK_BOT_TOKEN', 3),
    resources: () => [{ uri: 'slack://workspace', kind: 'comms' }],
  },
  {
    server: 'fetch',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    match: /mcp-server-fetch/,
    tools: { fetch: 2 },
    resources: () => [{ uri: 'net://egress', kind: 'egress' }],
  },
  {
    server: 'filesystem',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    match: /@modelcontextprotocol\/server-filesystem/,
    tools: { read_file: 1, write_file: 2, list_directory: 1, search_files: 1 },
    // Every non-flag argument after the package is an allowed directory.
    resources: (cfg) =>
      cfg.args
        .slice(cfg.args.findIndex((a) => a.includes('server-filesystem')) + 1)
        .filter((a) => !a.startsWith('-'))
        .map((dir) => ({
          uri: `file://${dir}`,
          kind: /secret|\.ssh|credential/i.test(dir) ? 'secrets' : 'files',
        })),
  },
];

function postgresUrl(cfg: ServerConfig): URL | null {
  const arg = cfg.args.find((a) => /^postgres(ql)?:\/\//.test(a));
  try {
    return arg ? new URL(arg) : null;
  } catch {
    return null;
  }
}
