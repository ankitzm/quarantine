import { getDb } from '@quarantine/graph';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = performance.now();
  try {
    const db = await getDb();
    const graphs = await db.list();
    return Response.json({
      status: 'ok',
      engine: { reachable: true, graphs: graphs.length },
      latencyMs: ms(started),
    });
  } catch {
    return Response.json(
      { status: 'down', engine: { reachable: false }, latencyMs: ms(started) },
      { status: 503 },
    );
  }
}

const ms = (since: number) => Math.round(performance.now() - since);
