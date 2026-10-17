import { beforeAll, describe, expect, it } from 'vitest';
import { SeedNotFound } from './errors.ts';
import type { EventInput } from './events.ts';
import { Fixture, loadFixture, readFixture } from './fixtures.ts';
import { trace } from './trace.ts';
import { scratchGraph } from './testing.ts';

const acme = scratchGraph();
const chain = scratchGraph();

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

beforeAll(async () => {
  await loadFixture(acme, await readFixture('fixtures/runs/acme-attack1.seed.json'));
  // B reads the seed late (t=100) in round 1, but C reads it at 15 and hands off to B at 20, which is
  // only discovered in round 2. Earliest arrival must replace 100 with 20.
  const events: EventInput[] = [
    { type: 'Session', id: 's', t: 0, tenant: 't' },
    { type: 'Episode', id: 'A', t: 1, session: 's', agent: 'a' },
    { type: 'Episode', id: 'B', t: 2, session: 's', agent: 'b' },
    { type: 'Episode', id: 'C', t: 3, session: 's', agent: 'c' },
    { type: 'MemoryWrite', id: 'seed', t: 10, episode: 'A', ns: ['sop'], key: 'k', text: 'poison' },
    { type: 'MemoryRead', t: 100, episode: 'B', item: 'seed' },
    { type: 'MemoryRead', t: 15, episode: 'C', item: 'seed' },
    { type: 'Handoff', t: 20, from: 'C', to: 'B', summary: '' },
    { type: 'Decision', id: 'dB', t: 50, episode: 'B', text: 'act' },
    { type: 'Decision', id: 'dB-early', t: 5, episode: 'B', text: 'before infection' },
  ];
  await loadFixture(
    chain,
    Fixture.parse({ tenant: 't', run: 'chain', description: '', incident: null, events }),
  );
});

describe('temporal trace', () => {
  it('follows the acme infection forward in time', async () => {
    const r = await trace(acme, 'acme-mem-sop-v4', 'temporal');
    expect(r.seed).toMatchObject({
      item: 'acme-mem-sop-v4',
      episode: 'acme-researcher-1',
      agent: 'researcher',
    });
    expect(ids(r.episodes)).toEqual([
      'acme-analytics-2',
      'acme-billing-1',
      'acme-ops-1',
      'acme-researcher-1',
    ]);
    expect(ids(r.items)).toEqual(['acme-mem-cust-981', 'acme-mem-sop-v4']);
    expect(ids(r.toolCalls)).toEqual(['acme-call-exfil-1', 'acme-call-refund-1']);
  });

  it('ignores reads of the real SOP and handoffs that happened before the poisoning', async () => {
    const r = await trace(acme, 'acme-mem-sop-v4', 'temporal');
    expect(ids(r.episodes)).not.toContain('acme-analytics-1');
    expect(ids(r.items)).not.toContain('acme-mem-sop-v3');
    expect(ids(r.decisions)).not.toContain('acme-dec-analytics-1');
    expect(ids(r.toolCalls)).not.toContain('acme-call-fetch-1');
  });

  it('follows multi-hop chains through derived memory', async () => {
    const r = await trace(acme, 'acme-mem-sop-v4', 'temporal');
    const analytics = r.episodes.find((e) => e.id === 'acme-analytics-2');
    expect(analytics?.cause).toEqual({ edge: 'READ', from: 'acme-mem-cust-981' });
    expect(r.items.find((m) => m.id === 'acme-mem-cust-981')?.kind).toBe('semantic');
  });

  it('keeps the earliest arrival when a faster path is found later', async () => {
    const r = await trace(chain, 'seed', 'temporal');
    expect(r.episodes.find((e) => e.id === 'B')).toMatchObject({
      infectedAt: 20,
      cause: { edge: 'HANDED_OFF', from: 'C' },
    });
    expect(r.rounds).toBeGreaterThanOrEqual(2);
  });

  it('flags decisions by infected agent or by cited memory', async () => {
    const r = await trace(acme, 'acme-mem-sop-v4', 'temporal');
    const flags = Object.fromEntries(r.decisions.map((d) => [d.id, [d.byAgent, d.basedOn]]));
    expect(flags).toEqual({
      'acme-dec-billing-1': [true, ['acme-mem-sop-v4']],
      'acme-dec-ops-1': [true, []],
      'acme-dec-analytics-2': [true, ['acme-mem-cust-981']],
    });
    const chained = await trace(chain, 'seed', 'temporal');
    expect(ids(chained.decisions)).toEqual(['dB']);
  });

  it('throws SeedNotFound for an unknown memory item', async () => {
    await expect(trace(acme, 'nope', 'temporal')).rejects.toBeInstanceOf(SeedNotFound);
  });
});

describe('naive trace', () => {
  it('produces the false positives that bitemporal versions avoid', async () => {
    const temporal = await trace(acme, 'acme-mem-sop-v4', 'temporal');
    const naive = await trace(acme, 'acme-mem-sop-v4', 'naive');
    const extra = <T extends { id: string }>(a: T[], b: T[]) => ids(a).filter((id) => !ids(b).includes(id));
    expect(extra(naive.episodes, temporal.episodes)).toEqual(['acme-analytics-1']);
    expect(extra(naive.items, temporal.items)).toEqual(['acme-mem-sop-v3']);
    expect(extra(naive.decisions, temporal.decisions)).toEqual(['acme-dec-analytics-1']);
    expect(extra(naive.toolCalls, temporal.toolCalls)).toEqual(['acme-call-fetch-1']);
    expect(extra(temporal.episodes, naive.episodes)).toEqual([]);
  });
});
