import { ensureDemoGraph, QuarantineError } from '@quarantine/graph';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const Tenant = z
  .string()
  .regex(/^[a-z0-9-]{1,40}$/)
  .default('acme');
export const Id = z.string().min(1).max(200);

const SID = 'sid';
const Sid = z.string().regex(/^[0-9a-f]{16}$/);

/** The visitor id from the `sid` cookie, issuing one if missing or malformed. */
export async function visitor(): Promise<string> {
  const jar = await cookies();
  const current = Sid.safeParse(jar.get(SID)?.value);
  if (current.success) return current.data;
  const sid = randomBytes(8).toString('hex');
  jar.set(SID, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 2 * 60 * 60,
    path: '/',
  });
  return sid;
}

export function tenantOf(req: Request): string {
  return Tenant.parse(new URL(req.url).searchParams.get('tenant') ?? undefined);
}

/**
 * The graph a request reads and writes: the visitor's private copy of the tenant, made on first use, so
 * nobody's plan or apply touches the base graphs or another visitor's state.
 */
export async function graphFor(req: Request): Promise<string> {
  return ensureDemoGraph(tenantOf(req), await visitor());
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
