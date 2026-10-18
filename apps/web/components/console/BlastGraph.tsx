'use client';

import { useMemo, useState } from 'react';
import { blastRadius, type BlastEdge, type BlastNode } from '@/lib/console/derive';
import type { ConsoleData } from '@/lib/console/use-console';
import s from './blast.module.css';

const COLS = ['Agents', 'Tools', 'Credentials', 'Resources'] as const;
const COL_W = 236;
const NODE_W = 188;
const ROW = 36;
const TOP = 36;

/**
 * The permission network behind the plan, left to right. With `showCut`, the plan's revocations appear
 * as quarantine tape; once applied, everything past the tape is drawn severed.
 */
export function BlastGraph({ data, showCut }: { data: ConsoleData; showCut: boolean }) {
  const { nodes, edges } = useMemo(() => blastRadius(data.plan), [data.plan]);
  const [focus, setFocus] = useState<string | null>(null);
  const applied = data.plan.appliedAt !== null;
  const infected = new Set(data.incident.trace.agents.map((a) => `agent:${a.id}`));

  // Barycentre layout: agents in order of infection, then each column sorted by the mean height of
  // whatever feeds it. One pass is enough for four columns and keeps crossings low.
  const order = new Map(
    [...data.incident.trace.agents]
      .sort((a, b) => a.infectedAt - b.infectedAt)
      .map((a, i) => [`agent:${a.id}`, i]),
  );
  const counts = COLS.map((_, c) => nodes.filter((n) => n.column === c).length);
  const rows = Math.max(...counts);
  const pos = new Map<string, { x: number; y: number }>();
  for (let c = 0; c < COLS.length; c++) {
    const meanY = (n: BlastNode) => {
      const ys = edges.filter((e) => e.to === n.id).flatMap((e) => pos.get(e.from)?.y ?? []);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
    };
    const col = nodes
      .filter((n) => n.column === c)
      .sort((a, b) =>
        c === 0
          ? (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99)
          : meanY(a) - meanY(b) || a.label.localeCompare(b.label),
      );
    const offset = ((rows - col.length) * ROW) / 2;
    col.forEach((n, i) => pos.set(n.id, { x: c * COL_W, y: TOP + offset + i * ROW }));
  }

  const lit = useMemo(() => (focus ? connected(focus, edges) : null), [focus, edges]);
  const severed = useMemo(
    () => (showCut && applied ? downstreamOfCut(nodes, edges) : new Set<string>()),
    [showCut, applied, nodes, edges],
  );
  const width = 3 * COL_W + NODE_W;
  const height = TOP + rows * ROW + 8;

  return (
    <div
      className={s.scroller}
      translate="no"
      tabIndex={0}
      aria-label="Permission network, scroll horizontally"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ maxWidth: width, minWidth: width * 0.72 }}
        className={s.chart}
        role="group"
        aria-label="Agents, tools, credentials and resources"
      >
        <defs>
          <pattern
            id="tape"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="10" height="10" fill="var(--tape)" />
            <rect width="4" height="10" fill="var(--ink)" />
          </pattern>
        </defs>
        {COLS.map((label, c) => (
          <text key={label} x={c * COL_W} y={14} className={s.colLabel}>
            {label}
          </text>
        ))}
        {edges.map((e) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + ROW / 2 - 4;
          const x2 = b.x;
          const y2 = b.y + ROW / 2 - 4;
          const mx = (x1 + x2) / 2;
          const state =
            severed.has(e.to) || severed.has(`${e.from}>${e.to}`)
              ? 'severed'
              : lit && !lit.has(edgeKey(e))
                ? 'dim'
                : 'live';
          return (
            <g key={edgeKey(e)}>
              <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} className={s[`edge_${state}`]} />
              {showCut && e.isCut && e.from.startsWith('agent:') && (
                <rect
                  x={mx - 15}
                  y={(y1 + y2) / 2 - 5}
                  width={30}
                  height={10}
                  fill="url(#tape)"
                  className={s.tape}
                />
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          return (
            <Node
              key={n.id}
              node={n}
              x={p.x}
              y={p.y}
              infected={infected.has(n.id)}
              taped={showCut && n.isCut && n.column === 2}
              dim={(lit !== null && !lit.has(n.id)) || severed.has(n.id)}
              onFocus={() => setFocus(n.id)}
              onBlur={() => setFocus(null)}
            />
          );
        })}
      </svg>
    </div>
  );
}

function Node(props: {
  node: BlastNode;
  x: number;
  y: number;
  infected: boolean;
  taped: boolean;
  dim: boolean;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const { node, x, y, infected, taped, dim } = props;
  const sub =
    node.column === 3 ? (node.sensitivity === 3 ? 'critical' : '') : node.column === 1 ? node.detail : '';
  return (
    <g
      transform={`translate(${x},${y})`}
      className={`${s.node} ${infected ? s.infected : ''} ${dim ? s.dim : ''}`}
      tabIndex={0}
      role="img"
      aria-label={`${COLS[node.column]}: ${node.label}${sub ? `, ${sub}` : ''}${taped ? ', rotated by the plan' : ''}`}
      onMouseEnter={props.onFocus}
      onMouseLeave={props.onBlur}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
    >
      <rect width={NODE_W} height={ROW - 8} rx={3} />
      <text x={10} y={18} className={s.label}>
        {truncate(node.label, sub ? 17 : 24)}
      </text>
      {sub && (
        <text x={NODE_W - 10} y={18} textAnchor="end" className={s.sub}>
          {sub}
        </text>
      )}
      {taped && <rect x={NODE_W + 6} y={-4} width={12} height={ROW} fill="url(#tape)" className={s.tape} />}
      <title>{node.detail || node.label}</title>
    </g>
  );
}

const edgeKey = (e: BlastEdge) => `${e.from}>${e.to}`;
const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Every node and edge on a path through `id`, upstream and downstream. */
function connected(id: string, edges: BlastEdge[]): Set<string> {
  const out = new Set<string>([id]);
  const walk = (start: string, dir: 'down' | 'up') => {
    const queue = [start];
    for (let n = queue.shift(); n; n = queue.shift()) {
      for (const e of edges) {
        const [from, to] = dir === 'down' ? [e.from, e.to] : [e.to, e.from];
        if (from === n) {
          out.add(edgeKey(e));
          if (!out.has(to)) {
            out.add(to);
            queue.push(to);
          }
        }
      }
    }
  };
  walk(id, 'down');
  walk(id, 'up');
  return out;
}

/** After apply: edges and nodes only reachable through a cut are severed. */
function downstreamOfCut(nodes: BlastNode[], edges: BlastEdge[]): Set<string> {
  const live = new Set(nodes.filter((n) => n.column === 0).map((n) => n.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const e of edges) {
      const passes = !e.isCut && !(nodes.find((n) => n.id === e.from)?.isCut && e.from.startsWith('cred:'));
      if (live.has(e.from) && passes && !live.has(e.to)) {
        live.add(e.to);
        changed = true;
      }
    }
  }
  const severed = new Set<string>();
  for (const n of nodes) if (!live.has(n.id)) severed.add(n.id);
  for (const e of edges) if (!live.has(e.to) || severed.has(e.from)) severed.add(edgeKey(e));
  return severed;
}
