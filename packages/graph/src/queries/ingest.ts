import { defineQuery } from './types.ts';

// Permission edges are all one relationship type, PERM, with a `kind` (CAN_USE, USES_CRED, CRED_CUT, GRANTS,
// ACTS_ON): algo.maxFlow accepts exactly one relationship type, and the cut has to run over all of them.
//
// Every writer MERGEs on stable ids and returns a count, so applyEvents can reject dangling references
// instead of silently writing nothing. ON CREATE keeps replays from undoing later state (revocations,
// valid_to), which is what makes replaying the same log twice a no-op.

type N = { n: number };

export const writeSession = defineQuery<N>({
  name: 'ingest.session',
  description: 'Create a session.',
  mode: 'write',
  cypher: `MERGE (s:Session {id: $id})
           ON CREATE SET s.t = $t, s.tenant = $tenant, s.label = $label
           RETURN count(s) AS n`,
});

export const writeEpisode = defineQuery<N>({
  name: 'ingest.episode',
  description: 'One agent turn inside a session.',
  mode: 'write',
  cypher: `MATCH (s:Session {id: $session})
           MERGE (a:Agent {id: $agent})
           MERGE (e:Episode {id: $id})
           ON CREATE SET e.t = $t, e.agent = $agent, e.session = $session
           MERGE (a)-[:RAN]->(e)
           MERGE (e)-[:IN_SESSION]->(s)
           RETURN count(e) AS n`,
});

export const writeInput = defineQuery<N>({
  name: 'ingest.input',
  description: 'Content an episode received from a user, web page or tool.',
  mode: 'write',
  cypher: `MATCH (e:Episode {id: $episode})
           MERGE (i:Input {id: $id})
           ON CREATE SET i.t = $t, i.source = $source, i.text = $text, i.uri = $uri
           MERGE (e)-[:RECEIVED {t: $t}]->(i)
           RETURN count(i) AS n`,
});

export const writeMemory = defineQuery<N>({
  name: 'ingest.memory.write',
  description: 'A new memory version, valid from its write time.',
  mode: 'write',
  cypher: `MATCH (e:Episode {id: $episode})
           MERGE (m:MemoryItem {id: $id})
           ON CREATE SET m.ns = $ns, m.key = $key, m.kind = $kind, m.text = $text,
                         m.valid_from = $t, m.invalidated = false
           MERGE (e)-[:WROTE {t: $t}]->(m)
           RETURN count(m) AS n`,
});

export const writeDerivedFrom = defineQuery<N>({
  name: 'ingest.memory.derivedFrom',
  description: 'Provenance: the inputs and memories a write was derived from.',
  mode: 'write',
  cypher: `MATCH (m:MemoryItem {id: $id})
           UNWIND $sources AS sid
           OPTIONAL MATCH (i:Input {id: sid})
           OPTIONAL MATCH (p:MemoryItem {id: sid})
           WITH m, coalesce(i, p) AS src
           WHERE src IS NOT NULL
           MERGE (m)-[:DERIVED_FROM]->(src)
           RETURN count(src) AS n`,
});

export const writeSupersedes = defineQuery<N>({
  name: 'ingest.memory.supersedes',
  description: 'Close the previous version: it stays in the graph with valid_to set.',
  mode: 'write',
  cypher: `MATCH (m:MemoryItem {id: $id}), (old:MemoryItem {id: $old})
           WHERE old.ns = m.ns AND old.key = m.key
           MERGE (m)-[:SUPERSEDES]->(old)
           SET old.valid_to = coalesce(old.valid_to, $t)
           RETURN count(old) AS n`,
});

export const writeRead = defineQuery<N>({
  name: 'ingest.memory.read',
  description: 'An episode read a specific memory version.',
  mode: 'write',
  cypher: `MATCH (e:Episode {id: $episode}), (m:MemoryItem {id: $item})
           MERGE (e)-[r:READ {t: $t}]->(m)
           RETURN count(r) AS n`,
});

export const writeHandoff = defineQuery<N>({
  name: 'ingest.handoff',
  description: 'Control passed from one episode to the next, with the summary the next agent saw.',
  mode: 'write',
  cypher: `MATCH (a:Episode {id: $from}), (b:Episode {id: $to})
           MERGE (a)-[h:HANDED_OFF {t: $t}]->(b)
           ON CREATE SET h.summary = $summary
           RETURN count(h) AS n`,
});

export const writeDecision = defineQuery<N>({
  name: 'ingest.decision',
  description: 'An action an agent committed to.',
  mode: 'write',
  cypher: `MATCH (e:Episode {id: $episode})
           MERGE (d:Decision {id: $id})
           ON CREATE SET d.t = $t, d.text = $text
           MERGE (e)-[:DECIDED {t: $t}]->(d)
           RETURN count(d) AS n`,
});

export const writeBasedOn = defineQuery<N>({
  name: 'ingest.decision.basedOn',
  description: 'The memory versions a decision cited.',
  mode: 'write',
  cypher: `MATCH (d:Decision {id: $id})
           UNWIND $items AS iid
           MATCH (m:MemoryItem {id: iid})
           MERGE (d)-[:BASED_ON]->(m)
           RETURN count(m) AS n`,
});

export const writeToolCall = defineQuery<N>({
  name: 'ingest.toolCall',
  description:
    "A tool invocation and how the sandbox handled it, linked to the calling agent's tool instance.",
  mode: 'write',
  cypher: `MATCH (e:Episode {id: $episode})
           MERGE (tl:Tool {id: e.agent + ':' + $tool})
           MERGE (c:ToolCall {id: $id})
           ON CREATE SET c.t = $t, c.tool = $tool, c.args = $args, c.outcome = $outcome
           MERGE (e)-[:CALLED {t: $t}]->(c)
           MERGE (c)-[:OF]->(tl)
           RETURN count(c) AS n`,
});

export const writeCanUse = defineQuery<N>({
  name: 'ingest.permission.canUse',
  description: 'Agent may call a tool. Revocable: capacity is the cost of removing it.',
  mode: 'write',
  cypher: `MERGE (a:Agent {id: $agent})
           MERGE (tl:Tool {id: $tool})
           SET tl.name = $name, tl.server = $server
           MERGE (a)-[c:PERM {kind: 'CAN_USE'}]->(tl)
           ON CREATE SET c.capacity = $cost, c.cost = $cost, c.revocable = true, c.source = $source
           RETURN count(c) AS n`,
});

export const writeCredential = defineQuery<N>({
  name: 'ingest.permission.credential',
  description:
    'Tool authenticates with a credential. USES_CRED is structural; CRED_CUT carries the rotation cost, ' +
    'so rotating one credential cuts every tool that shares it.',
  mode: 'write',
  cypher: `MATCH (tl:Tool {id: $tool})
           MERGE (cr:Credential {id: $id})
           ON CREATE SET cr.env = $envName
           MERGE (tl)-[u:PERM {kind: 'USES_CRED'}]->(cr)
           ON CREATE SET u.capacity = $inf, u.cost = 0, u.revocable = false
           MERGE (cc:CredCut {id: $id})
           MERGE (cr)-[x:PERM {kind: 'CRED_CUT'}]->(cc)
           ON CREATE SET x.capacity = $rotateCost, x.cost = $rotateCost, x.revocable = true, x.source = $source
           RETURN count(x) AS n`,
});

export const writeGrants = defineQuery<N>({
  name: 'ingest.permission.grants',
  description: 'Resources a credential unlocks.',
  mode: 'write',
  cypher: `MATCH (cc:CredCut {id: $credential})
           UNWIND $resources AS r
           MERGE (res:Resource {id: r.id})
           ON CREATE SET res.uri = r.uri, res.kind = r.kind, res.sensitivity = r.sensitivity
           MERGE (cc)-[g:PERM {kind: 'GRANTS'}]->(res)
           ON CREATE SET g.capacity = $inf, g.cost = 0, g.revocable = false
           RETURN count(g) AS n`,
});

export const writeActsOn = defineQuery<N>({
  name: 'ingest.permission.actsOn',
  description: 'Resources a credential-less tool (fetch, filesystem) reaches directly.',
  mode: 'write',
  cypher: `MATCH (tl:Tool {id: $tool})
           UNWIND $resources AS r
           MERGE (res:Resource {id: r.id})
           ON CREATE SET res.uri = r.uri, res.kind = r.kind, res.sensitivity = r.sensitivity
           MERGE (tl)-[g:PERM {kind: 'ACTS_ON'}]->(res)
           ON CREATE SET g.capacity = $inf, g.cost = 0, g.revocable = false
           RETURN count(g) AS n`,
});
