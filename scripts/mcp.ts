// Quarantine MCP server over stdio, for Claude Desktop, Cursor or the Sentinel.
// Usage: pnpm -s mcp [tenant]      (default acme)
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tenantGraph } from '@quarantine/graph';
import { createMcpServer } from '@quarantine/graph/mcp';

await createMcpServer(tenantGraph(process.argv[2] ?? 'acme')).connect(new StdioServerTransport());
