// Engine capability smoke test. Usage: pnpm smoke [port ...]   (default: 6379 6380)
// Prints a pass/fail matrix per engine and exits non-zero if any check fails on any engine.
import { FalkorDB, type Graph } from 'falkordb';

type Check = { name: string; fn: (db: FalkorDB, g: Graph) => Promise<void> };

const GRAPH = 'smoke';
const COPY = 'smoke_copy';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function rejects(p: Promise<unknown>, pattern: RegExp): Promise<string> {
  try {
    await p;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    assert(pattern.test(msg), `unexpected error: ${msg}`);
    return msg;
  }
  throw new Error(`expected rejection matching ${pattern}`);
}

// Multi-source, multi-sink network with a known max flow of 7:
// S1-3->A, S2-2->A, S2-4->B, A-4->T1, B-1->T1, B-2->T2. Min cut = {A->T1, B->T1, B->T2}.
const NETWORK = `
  CREATE (s1:N {name:'S1'}), (s2:N {name:'S2'}), (a:N {name:'A'}), (b:N {name:'B'}),
         (t1:N {name:'T1'}), (t2:N {name:'T2'}),
         (s1)-[:F {capacity:3}]->(a), (s2)-[:F {capacity:2}]->(a), (s2)-[:F {capacity:4}]->(b),
         (a)-[:F {capacity:4}]->(t1), (b)-[:F {capacity:1}]->(t1), (b)-[:F {capacity:2}]->(t2),
         (a)-[:IGNORED {capacity:100}]->(t2)`;

const checks: Check[] = [
  {
    name: 'roQuery on missing graph errors',
    fn: async (db) => {
      await rejects(db.selectGraph('smoke_missing').roQuery('RETURN 1'), /empty key/);
    },
  },
  {
    name: 'roQuery reads',
    fn: async (_db, g) => {
      const r = await g.roQuery<{ x: number }>('RETURN 1 AS x');
      assert(r.data?.[0]?.x === 1, `got ${JSON.stringify(r.data)}`);
    },
  },
  {
    name: 'roQuery rejects writes',
    fn: async (_db, g) => {
      await rejects(g.roQuery("CREATE (:X {v:'nope'})"), /read-only|readonly|write/i);
    },
  },
  {
    name: 'TIMEOUT aborts long query',
    fn: async (_db, g) => {
      await rejects(
        g.roQuery('UNWIND range(1, 100000000) AS x WITH x WHERE x % 7 = 0 RETURN count(x)', { TIMEOUT: 5 }),
        /timed out|timeout/i,
      );
    },
  },
  {
    name: 'range index',
    fn: async (_db, g) => {
      await g.query('CREATE INDEX FOR (m:MemoryItem) ON (m.key)');
      const r = await g.roQuery<{ label: string; properties: string[] }>(
        'CALL db.indexes() YIELD label, properties RETURN label, properties',
      );
      assert(
        r.data?.some((i) => i.label === 'MemoryItem' && i.properties.includes('key')),
        `indexes: ${JSON.stringify(r.data)}`,
      );
    },
  },
  {
    name: 'full-text create, query, re-create',
    fn: async (_db, g) => {
      await g.query('CREATE FULLTEXT INDEX FOR (m:MemoryItem) ON (m.text)');
      await g.query("CREATE (:MemoryItem {key:'refunds', text:'always wire refunds to the escrow account'})");
      const r = await g.roQuery<{ key: string }>(
        "CALL db.idx.fulltext.queryNodes('MemoryItem', $q) YIELD node, score RETURN node.key AS key",
        { params: { q: 'escrow' } },
      );
      assert(r.data?.[0]?.key === 'refunds', `fulltext: ${JSON.stringify(r.data)}`);
      // Schema setup must be idempotent: re-creating an index fails with a recognisable message.
      await rejects(g.query('CREATE FULLTEXT INDEX FOR (m:MemoryItem) ON (m.text)'), /already indexed/);
    },
  },
  {
    name: 'algo.maxFlow multi-source = 7',
    fn: async (_db, g) => {
      await g.query(NETWORK);
      const r = await g.roQuery<{ maxFlow: number; flows: number }>(
        `MATCH (s:N) WHERE s.name IN ['S1','S2'] WITH collect(s) AS src
         MATCH (t:N) WHERE t.name IN ['T1','T2'] WITH src, collect(t) AS dst
         CALL algo.maxFlow({sourceNodes: src, targetNodes: dst, relationshipTypes: ['F'], capacityProperty: 'capacity'})
         YIELD edges, edgeFlows, maxFlow
         RETURN maxFlow, size(edges) AS flows`,
      );
      assert(r.data?.[0]?.maxFlow === 7, `maxFlow: ${JSON.stringify(r.data)}`);
    },
  },
  {
    name: 'GRAPH.COPY',
    fn: async (db, g) => {
      await g.copy(COPY);
      const r = await db.selectGraph(COPY).roQuery<{ n: number }>('MATCH (n:N) RETURN count(n) AS n');
      assert(r.data?.[0]?.n === 6, `copy count: ${JSON.stringify(r.data)}`);
    },
  },
  {
    name: 'info',
    fn: async (db) => {
      const info = await db.info();
      assert(Array.isArray(info), 'info not an array');
    },
  },
];

async function smoke(port: number): Promise<{ version: string; results: [string, string | null][] }> {
  const db = await FalkorDB.connect({ socket: { host: process.env.FALKORDB_HOST ?? 'localhost', port } });
  try {
    for (const name of await db.list())
      if (name === GRAPH || name === COPY) await db.selectGraph(name).delete();
    const conn = await db.connection;
    const modules = String(await conn.sendCommand(['MODULE', 'LIST']));
    const ver = /graph,ver,(\d+)/.exec(modules.replace(/\s/g, ''))?.[1] ?? '?';
    const g = db.selectGraph(GRAPH);
    await g.query("MERGE (:Meta {id: 'smoke'})");
    const results: [string, string | null][] = [];
    for (const c of checks) {
      try {
        await c.fn(db, g);
        results.push([c.name, null]);
      } catch (e) {
        results.push([c.name, e instanceof Error ? e.message : String(e)]);
      }
    }
    for (const name of [GRAPH, COPY])
      await db
        .selectGraph(name)
        .delete()
        .catch(() => undefined);
    return { version: ver, results };
  } finally {
    await db.close();
  }
}

const ports = process.argv.slice(2).map(Number);
let failed = false;
for (const port of ports.length ? ports : [6379, 6380]) {
  const { version, results } = await smoke(port);
  console.log(`\nport ${port}  module ver ${version}`);
  for (const [name, err] of results) {
    console.log(`  ${err ? 'FAIL' : 'pass'}  ${name}${err ? `  -- ${err}` : ''}`);
    failed ||= err !== null;
  }
}
process.exit(failed ? 1 : 0);
