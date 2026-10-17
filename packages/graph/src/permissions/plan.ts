import { ConfirmRequired, PlanNotFound } from '../errors.ts';
import { stableId } from '../events.ts';
import { applyEvents } from '../ingest.ts';
import * as q from '../queries/permissions.ts';
import { run } from '../run.ts';
import { trace } from '../trace.ts';
import { SENSITIVE } from './manifests.ts';
import { minCut } from './mincut.ts';

export interface Revocation {
  action: 'revoke-tool' | 'rotate-credential';
  /** Agent id for revoke-tool, Credential id for rotate-credential. */
  from: string;
  /** Tool id for revoke-tool, CredCut id for rotate-credential. */
  to: string;
  label: string;
  cost: number;
  /** Config file and docs the permission came from. */
  source: string | null;
}

export interface Plan {
  id: string;
  seed: string;
  agents: string[];
  reach: q.ReachRow[];
  maxFlow: number;
  totalCost: number;
  cut: Revocation[];
}

export interface ApplyResult {
  plan: string;
  revoked: number;
  restored: string | null;
  reachAfter: q.ReachRow[];
}

export const QUARANTINE_AGENT = 'quarantine';

const idOf = (key: string) => key.slice(key.indexOf(':') + 1);

export function reachOf(graph: string, agents: string[]): Promise<q.ReachRow[]> {
  return run(graph, q.reach, { agents, minSensitivity: SENSITIVE });
}

/**
 * The cheapest set of revocations that disconnects every infected agent from every sensitive resource.
 * Infected agents come from the temporal trace; the cut comes from algo.maxFlow plus a residual-graph
 * BFS. The plan is stored so apply acts on exactly what was reviewed.
 */
export async function planQuarantine(graph: string, seed: string, now = Date.now()): Promise<Plan> {
  const { agents: infected } = await trace(graph, seed, 'temporal');
  const agents = infected.map((a) => a.id).sort();
  const reach = await reachOf(graph, agents);
  let maxFlow = 0;
  let cut: Revocation[] = [];

  if (reach.length) {
    const resources = [...new Set(reach.map((r) => r.resource))].sort();
    const [edges, [flow]] = await Promise.all([
      run(graph, q.network, { agents, minSensitivity: SENSITIVE }),
      run(graph, q.maxFlow, { agents, resources }),
    ]);
    if (!flow) throw new Error('algo.maxFlow returned no result');
    maxFlow = flow.maxFlow;
    const flowByEdge = new Map(flow.edges.map((id, i) => [id, flow.flows[i] ?? 0]));
    cut = minCut(edges, flowByEdge, maxFlow).map((e) => {
      const rotate = e.type === 'CRED_CUT';
      const [from, to] = [idOf(e.fromKey), idOf(e.toKey)];
      return {
        action: rotate ? 'rotate-credential' : 'revoke-tool',
        from,
        to,
        label: rotate ? `Rotate ${e.fromName}` : `Revoke ${e.toName} from ${from}`,
        cost: e.cost,
        source: e.source,
      };
    });
  }

  const body = { seed, agents, reach, maxFlow, totalCost: cut.reduce((s, c) => s + c.cost, 0), cut };
  const plan: Plan = { id: stableId('plan', graph, JSON.stringify(body)), ...body };
  await run(graph, q.savePlan, { id: plan.id, seed, json: JSON.stringify(plan), now });
  return plan;
}

export async function getPlan(graph: string, id: string): Promise<Plan & { appliedAt: number | null }> {
  const [row] = await run(graph, q.loadPlan, { id });
  if (!row) throw new PlanNotFound(id);
  return { ...(JSON.parse(row.json) as Plan), appliedAt: row.appliedAt };
}

/**
 * Applies a stored plan: revokes every cut edge (capacity 0, revoked_at set, nothing deleted), marks the
 * poisoned memory invalidated, and restores the clean version it replaced as a new version that
 * SUPERSEDES the poison. Idempotent: applying the same plan again changes nothing.
 */
export async function applyQuarantine(
  graph: string,
  planId: string,
  { confirm, now = Date.now() }: { confirm: boolean; now?: number },
): Promise<ApplyResult> {
  if (!confirm) throw new ConfirmRequired();
  const plan = await getPlan(graph, planId);
  // Re-applying replays the original timestamps, so the second run matches every MERGE exactly.
  now = plan.appliedAt ?? now;

  for (const r of plan.cut) {
    const query = r.action === 'rotate-credential' ? q.rotateCredential : q.revokeCanUse;
    const [row] = await run(graph, query, { from: r.from, to: r.to, now, plan: plan.id });
    if (row?.n !== 1) throw new Error(`plan ${plan.id}: ${r.label} matched ${row?.n ?? 0} edges`);
  }

  const [poison] = await run(graph, q.invalidateMemory, { seed: plan.seed, plan: plan.id });
  let restored: string | null = null;
  if (poison?.previous && poison.text !== null) {
    restored = stableId('restore', plan.seed);
    const session = stableId('qsession', plan.id);
    const episode = stableId('qepisode', plan.id);
    await applyEvents(graph, [
      { type: 'Session', id: session, t: now, tenant: graph, label: `Quarantine ${plan.id}` },
      { type: 'Episode', id: episode, t: now, session, agent: QUARANTINE_AGENT },
      {
        type: 'MemoryWrite',
        id: restored,
        t: now,
        episode,
        ns: poison.ns.split('/'),
        key: poison.key,
        text: poison.text,
        derivedFrom: [poison.previous],
        supersedes: plan.seed,
      },
    ]);
  }
  await run(graph, q.markApplied, { id: plan.id, now });

  return { plan: plan.id, revoked: plan.cut.length, restored, reachAfter: await reachOf(graph, plan.agents) };
}
