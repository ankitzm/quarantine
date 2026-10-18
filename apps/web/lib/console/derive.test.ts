import { describe, expect, it } from 'vitest';
import type {
  IncidentResponse,
  MemoryResponse,
  PlanResponse,
  TimelineResponse,
} from '@quarantine/graph/types';
import incident from '../../mocks/incident.temporal.json';
import memory from '../../mocks/memory.json';
import plan from '../../mocks/plan.json';
import timeline from '../../mocks/timeline.json';
import { blastRadius, credentialLabel, hops, storyline } from './derive';

const trace = (incident as IncidentResponse).trace;

describe('derive', () => {
  it('counts hops from patient zero', () => {
    // researcher -> billing (handoff) -> ops (handoff); billing -> note -> analytics (read)
    expect(hops(trace)).toBe(2);
  });

  it('lays the storyline out on an ordinal axis with session breaks', () => {
    const s = storyline(timeline as TimelineResponse, memory as MemoryResponse, trace, ['acme-mem-sop-v3']);
    expect(s.lanes).toEqual(['researcher', 'billing', 'ops', 'analytics']);
    expect(s.slots).toBe((timeline as TimelineResponse).events.length);
    expect(s.breaks.map((b) => b.label)).toEqual(['+1 h', '+1 day']);
    expect(Object.fromEntries(s.chips.map((c) => [c.id, [c.status, c.isNaiveOnly]]))).toEqual({
      'acme-mem-sop-v3': ['clean', true],
      'acme-mem-sop-v4': ['poison', false],
      'acme-mem-cust-981': ['infected', false],
    });
  });

  it('turns a plan into a four-column network with the cut marked', () => {
    const { nodes, edges } = blastRadius(plan as PlanResponse);
    const cols = [0, 1, 2, 3].map((c) => nodes.filter((n) => n.column === c).length);
    expect(cols[0]).toBe(4);
    expect(cols[3]).toBe(6);
    expect(nodes.find((n) => n.id === 'cred:STRIPE_SECRET_KEY')?.isCut).toBe(true);
    expect(edges.some((e) => e.from === 'agent:billing' && e.to === 'tool:billing|fetch' && e.isCut)).toBe(
      true,
    );
    const cutCount = (plan as PlanResponse).cut.length;
    const tapes = nodes.filter((n) => n.isCut).length;
    expect(tapes).toBeLessThanOrEqual(cutCount);
  });

  it('labels postgres credentials by user and database', () => {
    expect(credentialLabel('postgres://billing@db.acme.internal:5432/crm')).toBe('billing@crm (postgres)');
    expect(credentialLabel('SLACK_BOT_TOKEN')).toBe('SLACK_BOT_TOKEN');
  });
});
