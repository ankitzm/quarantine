import { queryEvents, type QueryLogEntry } from '@quarantine/graph';
import { graphFor, handle } from '@/lib/http';
import { sse } from '@/lib/sse';

export const dynamic = 'force-dynamic';

/** Live Cypher log for the visitor's graph. */
export async function GET(req: Request) {
  let graph: string;
  try {
    graph = await graphFor(req);
  } catch (e) {
    return handle(() => Promise.reject(e));
  }
  return sse(req, (send) => {
    const onQuery = (e: QueryLogEntry) => e.graph === graph && send(e);
    queryEvents.on('query', onQuery);
    return () => queryEvents.off('query', onQuery);
  });
}
