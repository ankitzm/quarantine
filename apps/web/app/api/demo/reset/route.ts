import { ensureDemoGraph } from '@quarantine/graph';
import { handle, tenantOf, visitor } from '@/lib/http';

/** Throw away this visitor's copy and start again from the base tenant graph. */
export async function POST(req: Request) {
  return handle(async () => {
    const tenant = tenantOf(req);
    await ensureDemoGraph(tenant, await visitor(), { reset: true });
    return { tenant, resetAt: Date.now() };
  });
}
