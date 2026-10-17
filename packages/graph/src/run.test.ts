import { describe, expect, it } from 'vitest';
import { GraphNotReady, QueryTimeout } from './errors.ts';
import { defineQuery } from './queries/types.ts';
import { queryEvents, queryLog, redact, run } from './run.ts';
import { scratchGraph } from './testing.ts';

const graph = scratchGraph();

const create = defineQuery({
  name: 'test.create',
  description: 'create a node',
  mode: 'write',
  cypher: 'MERGE (n:T {id: $id}) RETURN n.id AS id',
});
const sneakyWrite = defineQuery({
  name: 'test.sneakyWrite',
  description: 'a write registered as a read',
  mode: 'read',
  cypher: "CREATE (:T {id: 'sneaky'})",
});
const slow = defineQuery<{ n: number }>({
  name: 'test.slow',
  description: 'long scan',
  mode: 'read',
  cypher: 'UNWIND range(1, 100000000) AS x WITH x WHERE x % 7 = 0 RETURN count(x) AS n',
});
const count = defineQuery<{ n: number }>({
  name: 'test.count',
  description: 'count nodes',
  mode: 'read',
  cypher: 'MATCH (n:T) RETURN count(n) AS n',
});

describe('run', () => {
  it('refuses a read on a graph that does not exist', async () => {
    await expect(run(`${graph}_missing`, count)).rejects.toBeInstanceOf(GraphNotReady);
  });

  it('writes idempotently and reads back', async () => {
    await run(graph, create, { id: 'a' });
    await run(graph, create, { id: 'a' });
    expect(await run(graph, count)).toEqual([{ n: 1 }]);
  });

  it('rejects writes registered as reads', async () => {
    await expect(run(graph, sneakyWrite)).rejects.toThrow();
    expect(await run(graph, count)).toEqual([{ n: 1 }]);
  });

  it('maps engine timeouts to QueryTimeout', async () => {
    await expect(run(graph, slow, {}, { timeoutMs: 5 })).rejects.toBeInstanceOf(QueryTimeout);
  });

  it('logs every statement with redacted params and emits it', async () => {
    const seen: string[] = [];
    queryEvents.on('query', (e) => seen.push(e.name));
    await run(graph, create, { id: 'b', apiKey: 'sk-live-123', text: 'x'.repeat(500) });
    const last = queryLog(1)[0];
    expect(last).toMatchObject({ graph, name: 'test.create', mode: 'write', rows: 1 });
    expect(last?.params).toMatchObject({ id: 'b', apiKey: '[redacted]' });
    expect(JSON.stringify(last)).not.toContain('sk-live');
    expect(String(last?.params.text).length).toBeLessThan(100);
    expect(seen).toEqual(['test.create']);
    expect(queryLog().some((e) => e.name === 'test.slow' && e.error)).toBe(true);
  });
});

describe('redact', () => {
  it('walks nested values', () => {
    expect(redact({ events: [{ password: 'p', ok: 1 }] })).toEqual({
      events: [{ password: '[redacted]', ok: 1 }],
    });
  });
});
