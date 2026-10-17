import { api, buildScan } from '@quarantine/graph';
import { handle } from '@/lib/http';
import { clientIp, tokenBucket } from '@/lib/rate-limit';

const MAX_BYTES = 64 * 1024;
const allow = tokenBucket({ capacity: 5, perMs: 60_000 });

const fail = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

/** Scan uploaded MCP configs: what could a compromised agent reach, and what is the cheapest cut. */
export async function POST(req: Request) {
  if (!allow(clientIp(req))) return fail(429, 'RATE_LIMITED', 'at most 5 scans per minute');
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES)
    return fail(413, 'PAYLOAD_TOO_LARGE', 'limit is 64 KB');
  const body = await req.text();
  if (Buffer.byteLength(body) > MAX_BYTES) return fail(413, 'PAYLOAD_TOO_LARGE', 'limit is 64 KB');
  return handle(async () => {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      json = undefined;
    }
    return buildScan(api.ScanRequest.parse(json));
  });
}
