import { randomUUID } from 'node:crypto';
import { afterAll } from 'vitest';
import { closeDb, getDb } from './client.ts';

/** A scratch graph (uniquely named by default), deleted with the shared connection closed after the test file. */
export function scratchGraph(name = `test_${randomUUID().slice(0, 8)}`): string {
  afterAll(async () => {
    const db = await getDb();
    if ((await db.list()).includes(name)) await db.selectGraph(name).delete();
    await closeDb();
  });
  return name;
}
