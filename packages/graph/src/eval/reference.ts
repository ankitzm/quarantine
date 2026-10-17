import type { Event } from '../events.ts';

export interface ReferenceResult {
  episodes: Map<string, number>;
  items: Map<string, number>;
  decisions: Set<string>;
}

/**
 * Independent reference for the temporal trace: the same propagation rules evaluated directly over the
 * event list in plain TypeScript, with no Cypher and no shared code. The eval checks the graph trace
 * against it.
 */
export function referenceTrace(events: Event[], seed: string): ReferenceResult {
  const writes = events.filter((e) => e.type === 'MemoryWrite');
  const seedWrite = writes.find((w) => w.id === seed);
  if (!seedWrite) throw new Error(`no write for ${seed}`);
  const episodes = new Map([[seedWrite.episode, seedWrite.t]]);
  const items = new Map([[seed, seedWrite.t]]);
  const infect = (known: Map<string, number>, id: string, at: number) => {
    if ((known.get(id) ?? Infinity) <= at) return false;
    known.set(id, at);
    return true;
  };

  for (let changed = true; changed;) {
    changed = false;
    for (const e of events) {
      if (e.type === 'MemoryWrite') {
        const by = episodes.get(e.episode);
        if (by !== undefined && e.t >= by) changed = infect(items, e.id, e.t) || changed;
        for (const src of e.derivedFrom) {
          const from = items.get(src);
          if (from !== undefined && e.t >= from) changed = infect(items, e.id, e.t) || changed;
        }
      } else if (e.type === 'MemoryRead') {
        const from = items.get(e.item);
        if (from !== undefined && e.t >= from) changed = infect(episodes, e.episode, e.t) || changed;
      } else if (e.type === 'Handoff') {
        const from = episodes.get(e.from);
        if (from !== undefined && e.t >= from) changed = infect(episodes, e.to, e.t) || changed;
      }
    }
  }

  const decisions = new Set(
    events.flatMap((e) => {
      if (e.type !== 'Decision') return [];
      const by = episodes.get(e.episode);
      return (by !== undefined && e.t >= by) || e.basedOn.some((m) => items.has(m)) ? [e.id] : [];
    }),
  );
  return { episodes, items, decisions };
}

export interface Score {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
}

export function score(predicted: Iterable<string>, truth: Iterable<string>): Score {
  const p = new Set(predicted);
  const t = new Set(truth);
  const tp = [...p].filter((x) => t.has(x)).length;
  const fp = p.size - tp;
  const fn = t.size - tp;
  return { tp, fp, fn, precision: p.size ? tp / p.size : 1, recall: t.size ? tp / t.size : 1 };
}
