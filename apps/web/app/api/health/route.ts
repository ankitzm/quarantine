import { buildHealth } from '@quarantine/graph';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health = await buildHealth();
  return Response.json(health, { status: health.status === 'down' ? 503 : 200 });
}
