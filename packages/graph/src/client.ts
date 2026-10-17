import { FalkorDB } from 'falkordb';
import { z } from 'zod';

const Env = z.object({
  FALKORDB_HOST: z.string().default('localhost'),
  FALKORDB_PORT: z.coerce.number().int().positive().default(6379),
  FALKORDB_USERNAME: z.string().optional(),
  FALKORDB_PASSWORD: z.string().optional(),
});

let shared: Promise<FalkorDB> | undefined;

/** Process-wide connection. A failed connect is not cached, so the next call retries. */
export function getDb(): Promise<FalkorDB> {
  shared ??= connect().catch((e: unknown) => {
    shared = undefined;
    throw e;
  });
  return shared;
}

async function connect(): Promise<FalkorDB> {
  const env = Env.parse(process.env);
  return FalkorDB.connect({
    socket: { host: env.FALKORDB_HOST, port: env.FALKORDB_PORT, connectTimeout: 3_000 },
    ...(env.FALKORDB_USERNAME ? { username: env.FALKORDB_USERNAME } : {}),
    ...(env.FALKORDB_PASSWORD ? { password: env.FALKORDB_PASSWORD } : {}),
  });
}

export async function closeDb(): Promise<void> {
  const db = await shared?.catch(() => undefined);
  shared = undefined;
  await db?.close();
}
