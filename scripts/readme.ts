// Regenerates the Cypher section of README.md from the query registry, so the docs are the code.
// Usage: pnpm readme [--check]   (--check fails if README.md is out of date)
import { readFile, writeFile } from 'node:fs/promises';
import { REGISTRY } from '@quarantine/graph';

const START = '<!-- queries:start -->';
const END = '<!-- queries:end -->';

const dedent = (cypher: string) => {
  const lines = cypher.split('\n');
  const indent = Math.min(
    ...lines
      .slice(1)
      .filter((l) => l.trim())
      .map((l) => l.length - l.trimStart().length),
  );
  return [lines[0], ...lines.slice(1).map((l) => l.slice(Number.isFinite(indent) ? indent : 0))]
    .join('\n')
    .trim();
};

const body = Object.entries(REGISTRY)
  .map(([group, queries]) =>
    [
      `### ${group}`,
      ...queries.map(
        (q) => `**\`${q.name}\`** (${q.mode}): ${q.description}\n\n\`\`\`cypher\n${dedent(q.cypher)}\n\`\`\``,
      ),
    ].join('\n\n'),
  )
  .join('\n\n');

const readme = await readFile('README.md', 'utf8');
const [head, rest] = readme.split(START);
const tail = rest?.split(END)[1];
if (head === undefined || tail === undefined) throw new Error('README.md is missing the queries markers');
const next = `${head}${START}\n\n${body}\n\n${END}${tail}`;
if (process.argv.includes('--check')) {
  if (next !== readme) {
    console.error('README.md Cypher section is stale: run pnpm readme');
    process.exit(1);
  }
} else {
  await writeFile('README.md', next);
}
