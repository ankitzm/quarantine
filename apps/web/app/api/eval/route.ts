import { buildEval } from '@quarantine/graph';
import { handle } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(() => buildEval());
}
