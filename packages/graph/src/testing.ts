import { randomUUID } from 'node:crypto';
import { afterAll } from 'vitest';
import { closeDb, getDb } from './client.ts';

/** A uniquely named scratch graph, deleted (with the shared connection closed) after the test file. */
export function scratchGraph(prefix = 'test'): string {
  const name = `${prefix}_${randomUUID().slice(0, 8)}`;
  afterAll(async () => {
    const db = await getDb();
    if ((await db.list()).includes(name)) await db.selectGraph(name).delete();
    await closeDb();
  });
  return name;
}
