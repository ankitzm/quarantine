import { defineQuery } from './types.ts';

// The permission network, every edge a PERM with a kind:
//   Agent -CAN_USE-> Tool -USES_CRED-> Credential -CRED_CUT-> CredCut -GRANTS-> Resource
//   Agent -CAN_USE-> Tool -ACTS_ON-> Resource                    (credential-less tools)
// Revoked edges keep their place (and cost) but have revoked_at set and capacity 0, so both reach and
// maxFlow ignore them.

export interface ReachRow {
  agent: string;
  tool: string;
  credential: string | null;
  resource: string;
  uri: string;
  kind: string;
  sensitivity: number;
}

export const reach = defineQuery<ReachRow>({
  name: 'permissions.reach',
  description: 'Every live path from the given agents to a sensitive resource.',
  mode: 'read',
  cypher: `UNWIND $agents AS aid
           MATCH p = (a:Agent {id: aid})-[:PERM]->(t:Tool)-[:PERM*1..3]->(r:Resource)
           WHERE r.sensitivity >= $minSensitivity AND all(e IN relationships(p) WHERE e.revoked_at IS NULL)
           WITH a, t, r, [n IN nodes(p) WHERE n:Credential | n.env] AS creds
           RETURN DISTINCT a.id AS agent, t.id AS tool, head(creds) AS credential, r.id AS resource,
                  r.uri AS uri, r.kind AS kind, r.sensitivity AS sensitivity
           ORDER BY agent, tool, resource`,
});

export interface NetworkEdge {
  id: number;
  type: string;
  from: number;
  to: number;
  fromKey: string;
  toKey: string;
  /** Human name of the start node: the env var / connection name for credentials. */
  fromName: string;
  /** Human name of the end node: server.tool for tools. */
  toName: string;
  capacity: number;
  cost: number;
  revocable: boolean;
  source: string | null;
}

export const network = defineQuery<NetworkEdge>({
  name: 'permissions.network',
  description: 'Every live edge on a path from the given agents to a sensitive resource, with capacities.',
  mode: 'read',
  cypher: `UNWIND $agents AS aid
           MATCH p = (a:Agent {id: aid})-[:PERM]->(:Tool)-[:PERM*1..3]->(r:Resource)
           WHERE r.sensitivity >= $minSensitivity AND all(e IN relationships(p) WHERE e.revoked_at IS NULL)
           UNWIND relationships(p) AS e
           WITH DISTINCT e
           WITH e, startNode(e) AS s, endNode(e) AS t
           RETURN id(e) AS id, e.kind AS type, id(s) AS from, id(t) AS to,
                  labels(s)[0] + ':' + s.id AS fromKey, labels(t)[0] + ':' + t.id AS toKey,
                  coalesce(s.env, s.id) AS fromName,
                  coalesce(t.server + '.' + t.name, t.id) AS toName, e.capacity AS capacity, e.cost AS cost, e.revocable AS revocable, e.source AS source
           ORDER BY id`,
});

export const maxFlow = defineQuery<{ maxFlow: number; edges: number[]; flows: number[] }>({
  name: 'permissions.maxFlow',
  description:
    'FalkorDB algo.maxFlow from infected agents to sensitive resources, capacity = revocation cost. ' +
    'Revoked edges have capacity 0 and carry no flow.',
  mode: 'read',
  cypher: `MATCH (a:Agent) WHERE a.id IN $agents
           WITH collect(a) AS sources
           MATCH (r:Resource) WHERE r.id IN $resources
           WITH sources, collect(r) AS targets
           CALL algo.maxFlow({sourceNodes: sources, targetNodes: targets,
                              relationshipTypes: ['PERM'], capacityProperty: 'capacity'})
           YIELD edges, edgeFlows, maxFlow
           RETURN maxFlow, [e IN edges | id(e)] AS edges, edgeFlows AS flows`,
});

export const savePlan = defineQuery<{ n: number }>({
  name: 'plan.save',
  description: 'Persist a computed plan so apply acts on exactly what was reviewed.',
  mode: 'write',
  cypher: `MERGE (p:Plan {id: $id})
           ON CREATE SET p.seed = $seed, p.json = $json, p.created_at = $now
           RETURN count(p) AS n`,
});

export const loadPlan = defineQuery<{ json: string; appliedAt: number | null }>({
  name: 'plan.load',
  description: 'A stored plan and whether it has been applied.',
  mode: 'read',
  cypher: `MATCH (p:Plan {id: $id}) RETURN p.json AS json, p.applied_at AS appliedAt`,
});

export const revokeCanUse = defineQuery<{ n: number }>({
  name: 'quarantine.revokeTool',
  description: "Remove an agent's access to a tool. The edge stays, with its cost, for audit.",
  mode: 'write',
  cypher: `MATCH (:Agent {id: $from})-[e:PERM {kind: 'CAN_USE'}]->(:Tool {id: $to})
           SET e.revoked_at = coalesce(e.revoked_at, $now), e.revoked_by = coalesce(e.revoked_by, $plan),
               e.capacity = 0
           RETURN count(e) AS n`,
});

export const rotateCredential = defineQuery<{ n: number }>({
  name: 'quarantine.rotateCredential',
  description: 'Rotate a credential: every tool using it loses the resources it granted.',
  mode: 'write',
  cypher: `MATCH (:Credential {id: $from})-[e:PERM {kind: 'CRED_CUT'}]->(:CredCut {id: $to})
           SET e.revoked_at = coalesce(e.revoked_at, $now), e.revoked_by = coalesce(e.revoked_by, $plan),
               e.capacity = 0
           RETURN count(e) AS n`,
});

export const invalidateMemory = defineQuery<{
  ns: string;
  key: string;
  previous: string | null;
  text: string | null;
}>({
  name: 'quarantine.invalidateMemory',
  description: 'Mark the poisoned version invalidated and return the clean version it replaced, if any.',
  mode: 'write',
  cypher: `MATCH (m:MemoryItem {id: $seed})
           SET m.invalidated = true, m.invalidated_by = coalesce(m.invalidated_by, $plan)
           WITH m
           OPTIONAL MATCH (m)-[:SUPERSEDES]->(prev:MemoryItem)
           RETURN m.ns AS ns, m.key AS key, prev.id AS previous, prev.text AS text`,
});

export const invalidateDerived = defineQuery<{ n: number }>({
  name: 'quarantine.invalidateDerived',
  description: 'Mark memory versions derived from the poison invalidated so stores stop serving them.',
  mode: 'write',
  cypher: `UNWIND $ids AS id
           MATCH (m:MemoryItem {id: id})
           SET m.invalidated = true, m.invalidated_by = coalesce(m.invalidated_by, $plan)
           RETURN count(m) AS n`,
});

export const markApplied = defineQuery<{ n: number }>({
  name: 'plan.markApplied',
  description: 'Record when a plan was applied.',
  mode: 'write',
  cypher: `MATCH (p:Plan {id: $id})
           SET p.applied_at = coalesce(p.applied_at, $now)
           RETURN count(p) AS n`,
});
