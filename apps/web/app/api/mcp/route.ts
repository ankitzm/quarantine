import { createMcpServer } from '@quarantine/graph/mcp';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { graphFor, handle } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Stateless MCP over Streamable HTTP: a fresh server per request, bound to the caller's graph. */
async function serve(req: Request): Promise<Response> {
  let graph: string;
  try {
    graph = graphFor(req);
  } catch (e) {
    return handle(() => Promise.reject(e));
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const server = createMcpServer(graph);
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}

export { serve as GET, serve as POST, serve as DELETE };
