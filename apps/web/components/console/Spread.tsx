'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { clock, storyline, type MemoryChip, type Storyline } from '@/lib/console/derive';
import type { ConsoleData } from '@/lib/console/use-console';
import s from './spread.module.css';

const LEFT = 112;
const MIN_SLOT = 38;
const MAX_SLOT = 64;
const GAP = 56;
const MEM_Y = 34;
const LANE0 = 104;
const LANE = 54;

type Ev = Storyline['events'][number];

const VERB: Record<Ev['kind'], string> = {
  input: 'received input',
  write: 'wrote',
  read: 'read',
  handoff: 'handed off to',
  decision: 'decided',
  toolCall: 'called',
};

export function Spread({
  data,
  round,
  roundOf,
  onReplay,
}: {
  data: ConsoleData;
  round: number;
  roundOf: Map<string, number>;
  onReplay: () => void;
}) {
  const { incident, timeline, memory } = data;
  const fp = incident.naiveFalsePositives;
  const [compare, setCompare] = useState(false);
  const [selected, setSelected] = useState<Ev | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const story = useMemo(
    () => storyline(timeline, memory, incident.trace, fp.items),
    [timeline, memory, incident.trace, fp.items],
  );

  // Stretch slots to fill the sheet, but never below a legible minimum (then the chart scrolls).
  const SLOT = Math.min(
    MAX_SLOT,
    Math.max(MIN_SLOT, (available - LEFT - story.breaks.length * GAP - 8) / Math.max(1, story.slots)),
  );
  const x = (slot: number) =>
    LEFT + slot * SLOT + story.breaks.filter((b) => b.slot <= slot).length * GAP + SLOT / 2;
  const laneY = (lane: number) => LANE0 + lane * LANE;
  const width = x(story.slots - 1) + SLOT;
  const height = laneY(story.lanes.length - 1) + 56;
  const revealed = (id: string) => round === Infinity || (roundOf.get(id) ?? Infinity) <= round;
  const state = (e: Ev) =>
    e.isInfected && (revealed(e.episode) || revealed(e.target))
      ? 'infected'
      : compare && e.isNaiveOnly
        ? 'ghost'
        : 'clean';
  const chipState = (c: MemoryChip) =>
    c.status === 'poison' || c.status === 'infected'
      ? revealed(c.id)
        ? 'infected'
        : 'clean'
      : c.status === 'restored'
        ? 'restored'
        : compare && c.isNaiveOnly
          ? 'ghost'
          : 'clean';
  const chipBy = new Map(story.chips.map((c) => [c.id, c]));
  const infectedAgents = new Set(incident.trace.agents.map((a) => a.id));
  const ghostCount = fp.episodes.length + fp.items.length + fp.decisions.length + fp.toolCalls.length;

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <label className={s.check}>
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          Compare with a time-blind trace
        </label>
        <button type="button" className={s.quiet} onClick={onReplay}>
          Replay spread
        </button>
      </div>
      {compare && (
        <p className={s.compareNote} role="status">
          A time-blind trace would also flag {ghostCount} things that happened before the poisoning, shown
          dashed. Quarantine leaves them alone because the infection could not have reached them yet.
        </p>
      )}

      <div
        ref={scroller}
        className={s.scroller}
        tabIndex={0}
        aria-label="Contact-tracing chart, scroll horizontally"
      >
        <svg
          width={width}
          height={height}
          className={s.chart}
          role="group"
          aria-label="Agent activity over time"
        >
          <text x={0} y={MEM_Y + 4} className={s.laneLabel}>
            memory
          </text>
          {story.lanes.map((agent, i) => (
            <g key={agent}>
              <line x1={LEFT - 8} x2={width} y1={laneY(i)} y2={laneY(i)} className={s.laneRule} />
              <text
                x={0}
                y={laneY(i) + 4}
                className={infectedAgents.has(agent) ? s.laneLabelInfected : s.laneLabel}
              >
                {agent}
              </text>
            </g>
          ))}
          {story.breaks.map((b) => {
            const bx = x(b.slot) - SLOT / 2 - GAP / 2;
            return (
              <g key={b.slot}>
                <line x1={bx} x2={bx} y1={12} y2={height - 24} className={s.break} />
                <text x={bx} y={height - 8} className={s.axis} textAnchor="middle">
                  {b.label}
                </text>
              </g>
            );
          })}
          {story.events
            .filter((e, i, all) => i === 0 || all[i - 1]?.session !== e.session)
            .map((e) => (
              <text key={e.slot} x={x(e.slot)} y={height - 8} className={s.axis} textAnchor="middle">
                {clock(e.t)}
              </text>
            ))}

          {story.events.map((e) => {
            const st = state(e);
            const chip = chipBy.get(e.target);
            if ((e.kind === 'write' || e.kind === 'read') && chip) {
              const y = laneY(e.lane);
              const cx = x(chip.slot);
              const d =
                e.kind === 'write'
                  ? `M${cx},${MEM_Y + 10} L${cx},${y}`
                  : `M${cx},${MEM_Y + 10} C${cx},${y} ${x(e.slot)},${MEM_Y + 30} ${x(e.slot)},${y}`;
              return <path key={`c${e.slot}`} d={d} className={s[`link_${st}`]} />;
            }
            if (e.kind === 'handoff' && e.targetAgent) {
              const to = story.lanes.indexOf(e.targetAgent);
              const ex = x(e.slot);
              return (
                <path
                  key={`c${e.slot}`}
                  d={`M${ex},${laneY(e.lane)} L${ex},${laneY(to) + (to > e.lane ? -8 : 8)}`}
                  className={s[`link_${st}`]}
                  markerEnd={st === 'infected' ? 'url(#arrow-infected)' : 'url(#arrow)'}
                />
              );
            }
            return null;
          })}

          {story.chips.map((c) => (
            <Chip key={c.id} chip={c} x={x(c.slot)} state={chipState(c)} />
          ))}

          {story.events.map((e) => (
            <g
              key={e.slot}
              transform={`translate(${x(e.slot)},${laneY(e.lane)})`}
              className={`${s.mark} ${s[`mark_${state(e)}`]} ${selected?.slot === e.slot ? s.selected : ''}`}
              tabIndex={0}
              role="button"
              aria-label={`${clock(e.t)} ${e.agent} ${VERB[e.kind]} ${e.targetAgent ?? ''}`}
              onMouseEnter={() => setSelected(e)}
              onFocus={() => setSelected(e)}
              onClick={() => setSelected(e)}
            >
              <rect x={-12} y={-12} width={24} height={24} className={s.hit} />
              <Shape kind={e.kind} />
            </g>
          ))}
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 8 8"
              refX="4"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" className={s.arrow} />
            </marker>
            <marker
              id="arrow-infected"
              viewBox="0 0 8 8"
              refX="4"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" className={s.arrowInfected} />
            </marker>
          </defs>
        </svg>
      </div>

      <Inspector event={selected} data={data} chip={selected ? chipBy.get(selected.target) : undefined} />
    </div>
  );
}

function Shape({ kind }: { kind: Ev['kind'] }) {
  switch (kind) {
    case 'write':
      return <rect x={-5} y={-5} width={10} height={10} />;
    case 'read':
      return <circle r={5.5} />;
    case 'decision':
      return <path d="M0,-7 L7,0 L0,7 L-7,0 z" />;
    case 'toolCall':
      return <path d="M0,-6.5 L6.5,5 L-6.5,5 z" />;
    case 'handoff':
      return <circle r={3} />;
    case 'input':
      return <rect x={-1.5} y={-7} width={3} height={14} />;
  }
}

function Chip({ chip, x, state }: { chip: MemoryChip; x: number; state: string }) {
  const w = chip.label.length * 6.6 + 18;
  return (
    <g transform={`translate(${x - w / 2},${MEM_Y - 11})`} className={`${s.chip} ${s[`chip_${state}`]}`}>
      <title>{`${chip.label} written ${clock(chip.t)}${chip.isInvalidated ? ', invalidated' : ''}`}</title>
      <rect width={w} height={22} rx={3} />
      <text x={w / 2} y={15} textAnchor="middle" className={chip.isInvalidated ? s.struck : undefined}>
        {chip.label}
      </text>
    </g>
  );
}

function Inspector({
  event,
  data,
  chip,
}: {
  event: Ev | null;
  data: ConsoleData;
  chip: MemoryChip | undefined;
}) {
  if (!event) {
    return <p className={s.inspector}>Hover or focus a mark to see what happened.</p>;
  }
  const ep = data.incident.trace.episodes.find((e) => e.id === event.episode);
  const cause = ep && event.t >= ep.infectedAt ? causeText(ep.cause, data) : null;
  const target = chip
    ? `${chip.label}${chip.status === 'poison' ? ' (poisoned version)' : ''}`
    : (event.targetAgent ?? '');
  return (
    <p className={s.inspector} aria-live="polite">
      <span className="mono">{clock(event.t)}</span> · <strong>{event.agent}</strong> {VERB[event.kind]}{' '}
      {target}
      {event.detail && event.kind !== 'read' && <span className={s.detail}> — “{event.detail}”</span>}
      {cause && <span className={s.cause}> · {cause}</span>}
      {!event.isInfected && event.isNaiveOnly && (
        <span className={s.ghostNote}> · before the poisoning; only a time-blind trace flags this</span>
      )}
    </p>
  );
}

function causeText(cause: { edge: string; from: string | null }, data: ConsoleData): string {
  const { trace } = data.incident;
  if (cause.edge === 'SEED') return 'patient zero';
  const fromEp = trace.episodes.find((e) => e.id === cause.from);
  const fromItem = trace.items.find((m) => m.id === cause.from);
  if (cause.edge === 'HANDED_OFF') return `infected by a handoff from ${fromEp?.agent ?? 'another agent'}`;
  if (cause.edge === 'READ')
    return `infected by reading ${fromItem ? `${fromItem.ns}/${fromItem.key}` : 'poisoned memory'}`;
  return 'infected';
}
