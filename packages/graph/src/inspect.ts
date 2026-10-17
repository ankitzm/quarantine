import { createHash } from 'node:crypto';
import { dumpEdges, dumpNodes } from './queries/inspect.ts';
import { run } from './run.ts';

/** Order-independent content hash of the whole graph. Equal hashes mean replay was deterministic. */
export async function graphHash(graph: string, ignore: readonly string[] = ['Meta']): Promise<string> {
  const nodes = (await run(graph, dumpNodes)).filter((n) => !n.labels.some((l) => ignore.includes(l)));
  const edges = await run(graph, dumpEdges);
  const lines = [
    ...nodes.map((n) => `N ${n.labels.join(':')} ${canonical(n.props)}`),
    ...edges.map((e) => `E ${e.type} ${e.from} ${e.to} ${canonical(e.props)}`),
  ].sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

function canonical(o: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
}
