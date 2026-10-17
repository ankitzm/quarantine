import { QuarantineError, tenantGraph } from '@quarantine/graph';
import { z } from 'zod';

export const Tenant = z
  .string()
  .regex(/^[a-z0-9-]{1,40}$/)
  .default('acme');
export const Id = z.string().min(1).max(200);

/** The graph a request reads and writes. */
export function graphFor(req: Request): string {
  return tenantGraph(Tenant.parse(new URL(req.url).searchParams.get('tenant') ?? undefined));
}

export function query(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

/** Runs a handler and maps failures onto the single error shape of the API contract. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail(
        422,
        'VALIDATION_ERROR',
        e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
      );
    }
    if (e instanceof QuarantineError) return fail(e.status, e.code, e.message);
    console.error(e);
    return fail(500, 'INTERNAL', 'internal error');
  }
}

const fail = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });
