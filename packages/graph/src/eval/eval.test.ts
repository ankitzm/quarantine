import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '../client.ts';
import { generateScenario } from './generate.ts';
import { runEval } from './run.ts';

afterAll(() => closeDb());

describe('eval', () => {
  it('generates the same scenario for the same seed', () => {
    expect(generateScenario(7)).toEqual(generateScenario(7));
    expect(generateScenario(7).poison).not.toBe('');
  });

  it('temporal trace matches the independent reference; cuts are optimal and close all reach', async () => {
    const { scenarios, summary } = await runEval([1, 2, 3]);
    expect(summary.temporal).toEqual({ precision: 1, recall: 1 });
    expect(summary.cutsOptimal).toBe(3);
    expect(summary.reachAfterQuarantineZero).toBe(3);
    for (const s of scenarios) expect(s.naive.episodes.recall).toBe(1);
  });
});
