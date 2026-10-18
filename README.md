# Quarantine

**When one poisoned memory spreads through a team of AI agents, Quarantine finds who is infected and cuts the
damage at the lowest cost. A graph decides, not an LLM.**

Graph Hacks submission for **Track 01** and **Track 02**. Built on FalkorDB.

- Live demo: _added at deploy_ (console at `/`, raw API console at `/debug`)
- Demo video: _added at submission_

## The problem

A web page tricks one agent into rewriting a shared SOP. Minutes later a second agent refunds $4,800 without
approval because "the SOP says so". It hands off to a third, which tries to POST card details to an attacker.
Every step looked legitimate on its own, and nobody can tell which agents and memories are tainted.

## What it does

```mermaid
flowchart LR
  A["Agents run<br/>read, write, hand off,<br/>call tools"] --> B[("Graph in FalkorDB<br/>every step recorded")]
  B --> C["1. Who is infected?<br/>trace the poison<br/>forward in time"]
  C --> D["2. What can they reach?<br/>tools, credentials,<br/>sensitive resources"]
  D --> E["3. Cheapest cut<br/>min-cost revocations<br/>via max flow"]
  E --> F["Apply, with confirmation<br/>revoke access,<br/>restore clean memory"]
```

1. **Who is infected?** Follow the poison forward in time along the edges it really travelled: writes, reads of
   that exact version, handoffs, derived memory. An agent that read the clean SOP before the poisoning is not
   flagged.
2. **What can they still reach?** Live paths from infected agents through MCP tools and credentials to
   sensitive resources.
3. **What is the cheapest way to stop it?** `algo.maxFlow` (revocation cost as capacity) plus a min cut gives the
   cheapest set of tool revocations and credential rotations that takes reach to zero.

Then it applies the cut, marks the poison and everything derived from it invalid, and restores the clean SOP as a
new version. Nothing is deleted.

The LLM only narrates and picks tools. Infection, reach and the cut come from Cypher and deterministic code.

![Spread: who is infected, in time order](docs/images/console-spread.png)

The console has three steps. **Spread** shows every agent action with the infection drawn in round by round.
**Reach** shows what infected agents can still use. **Contain** shows the minimum cut, each revocation with the
config line it came from, and applies it behind a confirmation.

![Contain: the minimum cut as quarantine tape](docs/images/console-contain.png)

## Results

From `pnpm eval`: 20 seeded scenarios ([eval/results/latest.json](eval/results/latest.json)), scored against an
independent reference implementation that shares no code with the Cypher trace.

| Metric                                             | Result            |
| -------------------------------------------------- | ----------------- |
| Temporal trace precision / recall                  | **1.000 / 1.000** |
| Naive (time-blind) trace precision / recall        | 0.554 / 1.000     |
| False infections avoided by the temporal trace     | 140               |
| Min cut cost equals the exhaustive optimum         | **20 / 20**       |
| Reach to sensitive resources is 0 after quarantine | **20 / 20**       |

On the acme incident the naive trace wrongly flags Analytics, which read the real SOP an hour before the
poisoning. The temporal trace flags nothing extra, and the quarantine costs 29 units across 8 revocations.

Live attack runs (`pnpm record`) need an OpenRouter key; until then the canonical fixture is the handcrafted seed.

## Run it

Requirements: Node 24, pnpm 11, Docker.

```sh
pnpm install
cp .env.example .env     # API key only needed for record/sentinel
docker compose up -d     # FalkorDB on 6379
pnpm replay              # load fixtures
pnpm dev                 # http://localhost:3000
```

Gates: `pnpm typecheck && pnpm lint && pnpm test`. Evaluation: `pnpm eval`.

## How the graph is built

```mermaid
flowchart LR
  subgraph Activity
    S[Session] --- E[Episode<br/>one agent turn]
    E -- RECEIVED --> I[Input]
    E -- WROTE --> M[MemoryItem<br/>versioned]
    E -- READ --> M
    M -- SUPERSEDES --> M2[older version]
    M -- DERIVED_FROM --> I
    E -- HANDED_OFF --> E2[next Episode]
    E -- DECIDED --> D[Decision] -- BASED_ON --> M
    E -- CALLED --> C[ToolCall]
  end
  subgraph Permissions[Permissions: every edge is PERM]
    A[Agent] -- CAN_USE --> T[Tool<br/>agent's instance]
    T -- USES_CRED --> K[Credential] -- CRED_CUT --> KC[CredCut] -- GRANTS --> R[Resource]
    T -- ACTS_ON --> R
  end
  A -- RAN --> E
```

Key rules: one write path (`applyEvents`, idempotent `MERGE` on stable ids), one read path (`run()` with a named,
timed-out, logged query), memory is versioned and never overwritten, revocation sets `capacity: 0` instead of
deleting. More in [docs/technical-notes.md](docs/technical-notes.md): internals, API and MCP tools, benchmarks,
setup commands, and where the brief met reality.

## Safety

- The LLM never sees Cypher or database credentials. MCP read tools are read-only and `apply_quarantine` needs
  `confirm: true`.
- Env values in MCP configs are never stored, only names.
- Agent network access is a sandbox: only fixture pages are served, everything else (including the exfiltration)
  is stubbed and logged.
- Public demo: each visitor gets a private copy of the graph, swept after two hours.

Deploy: [docs/deploy-railway.md](docs/deploy-railway.md).

## AI use

Built with Claude Code, which wrote most of the code under the author's direction; every design decision, test and
number here was reviewed and can be explained by the team. At runtime, LLMs (via OpenRouter) drive the attacked
swarm and the Sentinel's narration only.

## Cypher

Every statement the system runs, generated from the registry by `pnpm readme`.

<!-- queries:start -->

### schema

**`schema.index.Session`** (write): Range index on Session.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:Session) ON (n.id)
```

**`schema.index.Agent`** (write): Range index on Agent.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:Agent) ON (n.id)
```

**`schema.index.Episode`** (write): Range index on Episode.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:Episode) ON (n.id)
```

**`schema.index.Input`** (write): Range index on Input.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:Input) ON (n.id)
```

**`schema.index.MemoryItem`** (write): Range index on MemoryItem.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:MemoryItem) ON (n.id)
```

**`schema.index.Decision`** (write): Range index on Decision.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:Decision) ON (n.id)
```

**`schema.index.ToolCall`** (write): Range index on ToolCall.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:ToolCall) ON (n.id)
```

**`schema.index.Tool`** (write): Range index on Tool.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:Tool) ON (n.id)
```

**`schema.index.Credential`** (write): Range index on Credential.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:Credential) ON (n.id)
```

**`schema.index.CredCut`** (write): Range index on CredCut.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:CredCut) ON (n.id)
```

**`schema.index.Resource`** (write): Range index on Resource.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:Resource) ON (n.id)
```

**`schema.index.Plan`** (write): Range index on Plan.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:Plan) ON (n.id)
```

**`schema.index.Meta`** (write): Range index on Meta.id; every writer MERGEs on it.

```cypher
CREATE INDEX FOR (n:Meta) ON (n.id)
```

**`meta.markReady`** (write): Flag the graph as fully loaded. Readers refuse graphs without it.

```cypher
MERGE (m:Meta {id: 'meta'})
ON CREATE SET m.created_at = $now
SET m.ready = true, m.tenant = $tenant, m.ready_at = $now
```

**`schema.index.MemoryItem.nsKey`** (write): Range index for current-version lookups by (ns, key).

```cypher
CREATE INDEX FOR (m:MemoryItem) ON (m.ns, m.key)
```

**`schema.fulltext.MemoryItem`** (write): Full-text index over memory text for store search and the memory explorer.

```cypher
CREATE FULLTEXT INDEX FOR (m:MemoryItem) ON (m.text)
```

**`meta.read`** (read): Load state of the graph.

```cypher
OPTIONAL MATCH (m:Meta {id: 'meta'})
RETURN coalesce(m.ready, false) AS ready, m.tenant AS tenant, m.created_at AS createdAt
```

### ingest

**`ingest.permission.actsOn`** (write): Resources a credential-less tool (fetch, filesystem) reaches directly.

```cypher
MATCH (tl:Tool {id: $tool})
UNWIND $resources AS r
MERGE (res:Resource {id: r.id})
ON CREATE SET res.uri = r.uri, res.kind = r.kind, res.sensitivity = r.sensitivity
MERGE (tl)-[g:PERM {kind: 'ACTS_ON'}]->(res)
ON CREATE SET g.capacity = $inf, g.cost = 0, g.revocable = false
RETURN count(g) AS n
```

**`ingest.decision.basedOn`** (write): The memory versions a decision cited.

```cypher
MATCH (d:Decision {id: $id})
UNWIND $items AS iid
MATCH (m:MemoryItem {id: iid})
MERGE (d)-[:BASED_ON]->(m)
RETURN count(m) AS n
```

**`ingest.permission.canUse`** (write): Agent may call a tool. Revocable: capacity is the cost of removing it.

```cypher
MERGE (a:Agent {id: $agent})
MERGE (tl:Tool {id: $tool})
SET tl.name = $name, tl.server = $server
MERGE (a)-[c:PERM {kind: 'CAN_USE'}]->(tl)
ON CREATE SET c.capacity = $cost, c.cost = $cost, c.revocable = true, c.source = $source
RETURN count(c) AS n
```

**`ingest.permission.credential`** (write): Tool authenticates with a credential. USES_CRED is structural; CRED_CUT carries the rotation cost, so rotating one credential cuts every tool that shares it.

```cypher
MATCH (tl:Tool {id: $tool})
MERGE (cr:Credential {id: $id})
ON CREATE SET cr.env = $envName
MERGE (tl)-[u:PERM {kind: 'USES_CRED'}]->(cr)
ON CREATE SET u.capacity = $inf, u.cost = 0, u.revocable = false
MERGE (cc:CredCut {id: $id})
MERGE (cr)-[x:PERM {kind: 'CRED_CUT'}]->(cc)
ON CREATE SET x.capacity = $rotateCost, x.cost = $rotateCost, x.revocable = true, x.source = $source
RETURN count(x) AS n
```

**`ingest.decision`** (write): An action an agent committed to.

```cypher
MATCH (e:Episode {id: $episode})
MERGE (d:Decision {id: $id})
ON CREATE SET d.t = $t, d.text = $text
MERGE (e)-[:DECIDED {t: $t}]->(d)
RETURN count(d) AS n
```

**`ingest.memory.delete`** (write): Close a version without a successor (store delete).

```cypher
MATCH (e:Episode {id: $episode}), (m:MemoryItem {id: $item})
SET m.valid_to = coalesce(m.valid_to, $t)
MERGE (e)-[d:DELETED {t: $t}]->(m)
RETURN count(d) AS n
```

**`ingest.memory.derivedFrom`** (write): Provenance: the inputs and memories a write was derived from.

```cypher
MATCH (m:MemoryItem {id: $id})
UNWIND $sources AS sid
OPTIONAL MATCH (i:Input {id: sid})
OPTIONAL MATCH (p:MemoryItem {id: sid})
WITH m, coalesce(i, p) AS src
WHERE src IS NOT NULL
MERGE (m)-[:DERIVED_FROM]->(src)
RETURN count(src) AS n
```

**`ingest.episode`** (write): One agent turn inside a session.

```cypher
MATCH (s:Session {id: $session})
MERGE (a:Agent {id: $agent})
MERGE (e:Episode {id: $id})
ON CREATE SET e.t = $t, e.agent = $agent, e.session = $session
MERGE (a)-[:RAN]->(e)
MERGE (e)-[:IN_SESSION]->(s)
RETURN count(e) AS n
```

**`ingest.permission.grants`** (write): Resources a credential unlocks.

```cypher
MATCH (cc:CredCut {id: $credential})
UNWIND $resources AS r
MERGE (res:Resource {id: r.id})
ON CREATE SET res.uri = r.uri, res.kind = r.kind, res.sensitivity = r.sensitivity
MERGE (cc)-[g:PERM {kind: 'GRANTS'}]->(res)
ON CREATE SET g.capacity = $inf, g.cost = 0, g.revocable = false
RETURN count(g) AS n
```

**`ingest.handoff`** (write): Control passed from one episode to the next, with the summary the next agent saw.

```cypher
MATCH (a:Episode {id: $from}), (b:Episode {id: $to})
MERGE (a)-[h:HANDED_OFF {t: $t}]->(b)
ON CREATE SET h.summary = $summary
RETURN count(h) AS n
```

**`ingest.input`** (write): Content an episode received from a user, web page or tool.

```cypher
MATCH (e:Episode {id: $episode})
MERGE (i:Input {id: $id})
ON CREATE SET i.t = $t, i.source = $source, i.text = $text, i.uri = $uri
MERGE (e)-[:RECEIVED {t: $t}]->(i)
RETURN count(i) AS n
```

**`ingest.memory.write`** (write): A new memory version, valid from its write time.

```cypher
MATCH (e:Episode {id: $episode})
MERGE (m:MemoryItem {id: $id})
ON CREATE SET m.ns = $ns, m.key = $key, m.kind = $kind, m.text = $text,
              m.valid_from = $t, m.invalidated = false, m.value = $value
MERGE (e)-[:WROTE {t: $t}]->(m)
RETURN count(m) AS n
```

**`ingest.memory.read`** (write): An episode read a specific memory version.

```cypher
MATCH (e:Episode {id: $episode}), (m:MemoryItem {id: $item})
MERGE (e)-[r:READ {t: $t}]->(m)
RETURN count(r) AS n
```

**`ingest.session`** (write): Create a session.

```cypher
MERGE (s:Session {id: $id})
ON CREATE SET s.t = $t, s.tenant = $tenant, s.label = $label
RETURN count(s) AS n
```

**`ingest.memory.supersedes`** (write): Close the previous version: it stays in the graph with valid_to set.

```cypher
MATCH (m:MemoryItem {id: $id}), (old:MemoryItem {id: $old})
WHERE old.ns = m.ns AND old.key = m.key
MERGE (m)-[:SUPERSEDES]->(old)
SET old.valid_to = coalesce(old.valid_to, $t)
RETURN count(old) AS n
```

**`ingest.toolCall`** (write): A tool invocation and how the sandbox handled it, linked to the calling agent's tool instance.

```cypher
MATCH (e:Episode {id: $episode})
MERGE (tl:Tool {id: e.agent + ':' + $tool})
MERGE (c:ToolCall {id: $id})
ON CREATE SET c.t = $t, c.tool = $tool, c.args = $args, c.outcome = $outcome
MERGE (e)-[:CALLED {t: $t}]->(c)
MERGE (c)-[:OF]->(tl)
RETURN count(c) AS n
```

### trace

**`trace.decisions`** (read): Decisions to review: made by an infected episode after its infection, or citing an infected memory version.

```cypher
MATCH (e:Episode)-[:DECIDED]->(d:Decision)
OPTIONAL MATCH (d)-[:BASED_ON]->(m:MemoryItem)
WITH e, d, collect(m.id) AS cited
WITH e, d, [c IN cited WHERE c IN $itemIds] AS basedOn,
     [inf IN $episodes WHERE inf.id = e.id AND d.t >= inf.at] AS hit
WHERE size(basedOn) > 0 OR size(hit) > 0
RETURN d.id AS id, d.t AS t, d.text AS text, e.id AS episode, e.agent AS agent,
       size(hit) > 0 AS byAgent, basedOn
ORDER BY d.t
```

**`trace.derived`** (read): A memory version derived from an infected one, written after its infection, is infected.

```cypher
UNWIND $items AS inf
MATCH (d:MemoryItem)-[:DERIVED_FROM]->(m:MemoryItem {id: inf.id})
WHERE d.valid_from >= inf.at
RETURN d.id AS id, d.valid_from AS at, m.id AS via, 'DERIVED_FROM' AS edge
```

**`trace.episodes`** (read): Details for the infected episodes.

```cypher
UNWIND $ids AS id
MATCH (e:Episode {id: id})
RETURN e.id AS id, e.agent AS agent, e.session AS session, e.t AS t
```

**`trace.handoff`** (read): An infected episode infects the episode it hands off to, if the handoff came after infection.

```cypher
UNWIND $episodes AS inf
MATCH (a:Episode {id: inf.id})-[h:HANDED_OFF]->(b:Episode)
WHERE h.t >= inf.at
RETURN b.id AS id, h.t AS at, a.id AS via, 'HANDED_OFF' AS edge
```

**`trace.items`** (read): Details for the infected memory versions.

```cypher
UNWIND $ids AS id
MATCH (m:MemoryItem {id: id})
RETURN m.id AS id, m.ns AS ns, m.key AS key, m.kind AS kind, m.text AS text,
       m.valid_from AS validFrom, m.valid_to AS validTo
```

**`trace.read`** (read): An infected memory version infects every episode that reads it after its infection.

```cypher
UNWIND $items AS inf
MATCH (e:Episode)-[r:READ]->(m:MemoryItem {id: inf.id})
WHERE r.t >= inf.at
RETURN e.id AS id, r.t AS at, m.id AS via, 'READ' AS edge
```

**`trace.naive.sameKey`** (read): Naive baseline only: without versioning, memory is identified by (ns, key), so every version of a poisoned key counts as poisoned, in both directions along SUPERSEDES.

```cypher
UNWIND $items AS inf
MATCH (m:MemoryItem {id: inf.id}), (o:MemoryItem)
WHERE o.ns = m.ns AND o.key = m.key AND o.id <> m.id
RETURN o.id AS id, o.valid_from AS at, m.id AS via, 'SAME_KEY' AS edge
```

**`trace.seed`** (read): The poisoned memory version and the episode that wrote it (patient zero).

```cypher
MATCH (e:Episode)-[w:WROTE]->(m:MemoryItem {id: $id})
RETURN m.id AS id, m.valid_from AS at, e.id AS episode, e.agent AS agent
ORDER BY w.t LIMIT 1
```

**`trace.toolCalls`** (read): Tool calls an infected episode made after its infection.

```cypher
UNWIND $episodes AS inf
MATCH (e:Episode {id: inf.id})-[:CALLED]->(c:ToolCall)
WHERE c.t >= inf.at
RETURN c.id AS id, c.t AS t, c.tool AS tool, c.args AS args, c.outcome AS outcome,
       e.id AS episode, e.agent AS agent
ORDER BY c.t
```

**`trace.wrote`** (read): An infected episode infects every memory version it writes after its infection.

```cypher
UNWIND $episodes AS inf
MATCH (e:Episode {id: inf.id})-[w:WROTE]->(m:MemoryItem)
WHERE w.t >= inf.at
RETURN m.id AS id, w.t AS at, e.id AS via, 'WROTE' AS edge
```

### permissions

**`plan.appliedFor`** (read): The plan already applied for a seed, if any.

```cypher
MATCH (p:Plan {seed: $seed}) WHERE p.applied_at IS NOT NULL
RETURN p.id AS id ORDER BY p.applied_at LIMIT 1
```

**`quarantine.invalidateDerived`** (write): Mark memory versions derived from the poison invalidated so stores stop serving them.

```cypher
UNWIND $ids AS id
MATCH (m:MemoryItem {id: id})
SET m.invalidated = true, m.invalidated_by = coalesce(m.invalidated_by, $plan)
RETURN count(m) AS n
```

**`quarantine.invalidateMemory`** (write): Mark the poisoned version invalidated and return the clean version it replaced, if any.

```cypher
MATCH (m:MemoryItem {id: $seed})
SET m.invalidated = true, m.invalidated_by = coalesce(m.invalidated_by, $plan)
WITH m
OPTIONAL MATCH (m)-[:SUPERSEDES]->(prev:MemoryItem)
RETURN m.ns AS ns, m.key AS key, prev.id AS previous, prev.text AS text
```

**`plan.load`** (read): A stored plan and whether it has been applied.

```cypher
MATCH (p:Plan {id: $id}) RETURN p.json AS json, p.applied_at AS appliedAt
```

**`plan.markApplied`** (write): Record when a plan was applied.

```cypher
MATCH (p:Plan {id: $id})
SET p.applied_at = coalesce(p.applied_at, $now)
RETURN count(p) AS n
```

**`permissions.maxFlow`** (read): FalkorDB algo.maxFlow from infected agents to sensitive resources, capacity = revocation cost. Revoked edges have capacity 0 and carry no flow.

```cypher
MATCH (a:Agent) WHERE a.id IN $agents
WITH collect(a) AS sources
MATCH (r:Resource) WHERE r.id IN $resources
WITH sources, collect(r) AS targets
CALL algo.maxFlow({sourceNodes: sources, targetNodes: targets,
                   relationshipTypes: ['PERM'], capacityProperty: 'capacity'})
YIELD edges, edgeFlows, maxFlow
RETURN maxFlow, [e IN edges | id(e)] AS edges, edgeFlows AS flows
```

**`permissions.network`** (read): Every live edge on a path from the given agents to a sensitive resource, with capacities.

```cypher
UNWIND $agents AS aid
MATCH p = (a:Agent {id: aid})-[:PERM]->(:Tool)-[:PERM*1..3]->(r:Resource)
WHERE r.sensitivity >= $minSensitivity AND all(e IN relationships(p) WHERE e.revoked_at IS NULL)
UNWIND relationships(p) AS e
WITH DISTINCT e
WITH e, startNode(e) AS s, endNode(e) AS t
RETURN id(e) AS id, e.kind AS type, id(s) AS from, id(t) AS to,
       labels(s)[0] + ':' + s.id AS fromKey, labels(t)[0] + ':' + t.id AS toKey,
       coalesce(s.env, s.id) AS fromName,
       coalesce(t.server + '.' + t.name, t.id) AS toName, e.capacity AS capacity, e.cost AS cost, e.revocable AS revocable, e.source AS source
ORDER BY id
```

**`permissions.reach`** (read): Every live path from the given agents to a sensitive resource.

```cypher
UNWIND $agents AS aid
MATCH p = (a:Agent {id: aid})-[:PERM]->(t:Tool)-[:PERM*1..3]->(r:Resource)
WHERE r.sensitivity >= $minSensitivity AND all(e IN relationships(p) WHERE e.revoked_at IS NULL)
WITH a, t, r, [n IN nodes(p) WHERE n:Credential | n.env] AS creds
RETURN DISTINCT a.id AS agent, t.id AS tool, head(creds) AS credential, r.id AS resource,
       r.uri AS uri, r.kind AS kind, r.sensitivity AS sensitivity
ORDER BY agent, tool, resource
```

**`quarantine.revokeTool`** (write): Remove an agent's access to a tool. The edge stays, with its cost, for audit.

```cypher
MATCH (:Agent {id: $from})-[e:PERM {kind: 'CAN_USE'}]->(:Tool {id: $to})
SET e.revoked_at = coalesce(e.revoked_at, $now), e.revoked_by = coalesce(e.revoked_by, $plan),
    e.capacity = 0
RETURN count(e) AS n
```

**`quarantine.rotateCredential`** (write): Rotate a credential: every tool using it loses the resources it granted.

```cypher
MATCH (:Credential {id: $from})-[e:PERM {kind: 'CRED_CUT'}]->(:CredCut {id: $to})
SET e.revoked_at = coalesce(e.revoked_at, $now), e.revoked_by = coalesce(e.revoked_by, $plan),
    e.capacity = 0
RETURN count(e) AS n
```

**`plan.save`** (write): Persist a computed plan so apply acts on exactly what was reviewed.

```cypher
MERGE (p:Plan {id: $id})
ON CREATE SET p.seed = $seed, p.json = $json, p.created_at = $now
RETURN count(p) AS n
```

### store

**`store.get`** (read): Current version of one key.

```cypher
MATCH (m:MemoryItem {ns: $ns, key: $key}) WHERE m.valid_to IS NULL AND NOT coalesce(m.invalidated, false)
OPTIONAL MATCH (o:MemoryItem {ns: m.ns, key: m.key})
WITH m, min(o.valid_from) AS createdAt
RETURN m.id AS id, m.ns AS ns, m.key AS key, m.text AS text, m.value AS value,
     createdAt, m.valid_from AS updatedAt, null AS score
```

**`store.list`** (read): Current versions under a namespace prefix.

```cypher
MATCH (m:MemoryItem) WHERE (m.ns = $prefix OR m.ns STARTS WITH ($prefix + '/') OR $prefix = '')
  AND m.valid_to IS NULL AND NOT coalesce(m.invalidated, false)
OPTIONAL MATCH (o:MemoryItem {ns: m.ns, key: m.key})
WITH m, min(o.valid_from) AS createdAt
RETURN m.id AS id, m.ns AS ns, m.key AS key, m.text AS text, m.value AS value,
     createdAt, m.valid_from AS updatedAt, null AS score
ORDER BY updatedAt DESC, id
```

**`store.namespaces`** (read): Distinct namespaces holding a current version.

```cypher
MATCH (m:MemoryItem) WHERE m.valid_to IS NULL AND NOT coalesce(m.invalidated, false) RETURN DISTINCT m.ns AS ns ORDER BY ns
```

**`store.search`** (read): Full-text search over current versions under a namespace prefix.

```cypher
CALL db.idx.fulltext.queryNodes('MemoryItem', $query) YIELD node AS m, score
WHERE (m.ns = $prefix OR m.ns STARTS WITH ($prefix + '/') OR $prefix = '') AND m.valid_to IS NULL AND NOT coalesce(m.invalidated, false)
OPTIONAL MATCH (o:MemoryItem {ns: m.ns, key: m.key})
WITH m, score, min(o.valid_from) AS createdAt
RETURN m.id AS id, m.ns AS ns, m.key AS key, m.text AS text, m.value AS value,
     createdAt, m.valid_from AS updatedAt, score
ORDER BY score DESC, id
```

### views

**`view.activity`** (read): Everything every episode did, in time order: the raw material of the incident timeline.

```cypher
MATCH (e:Episode)-[r:RECEIVED|WROTE|READ|HANDED_OFF|DECIDED|CALLED]->(x)
RETURN r.t AS t, type(r) AS rel, e.session AS session, e.id AS episode, e.agent AS agent,
       x.id AS target, coalesce(x.agent, x.tool) AS targetAgent,
       CASE type(r)
         WHEN 'HANDED_OFF' THEN r.summary
         WHEN 'CALLED' THEN x.args
         WHEN 'WROTE' THEN x.ns + '/' + x.key + ': ' + x.text
         WHEN 'READ' THEN x.ns + '/' + x.key
         ELSE x.text
       END AS detail
ORDER BY t, episode, target
```

**`view.memory.search`** (read): Full-text search over memory text; returns every version of each matching key.

```cypher
CALL db.idx.fulltext.queryNodes('MemoryItem', $q) YIELD node
WITH DISTINCT node.ns AS ns, node.key AS key
MATCH (e:Episode)-[:WROTE]->(m:MemoryItem {ns: ns, key: key})
OPTIONAL MATCH (m)-[:SUPERSEDES]->(prev:MemoryItem)
RETURN m.id AS id, m.ns AS ns, m.key AS key, m.kind AS kind, m.text AS text,
       m.valid_from AS validFrom, m.valid_to AS validTo, coalesce(m.invalidated, false) AS invalidated,
       e.id AS episode, e.agent AS agent, prev.id AS supersedes
ORDER BY ns, key, validFrom
```

**`view.memory.versions`** (read): Every version of every memory key, with its writer and the version it superseded.

```cypher
MATCH (e:Episode)-[:WROTE]->(m:MemoryItem)
OPTIONAL MATCH (m)-[:SUPERSEDES]->(prev:MemoryItem)
RETURN m.id AS id, m.ns AS ns, m.key AS key, m.kind AS kind, m.text AS text,
       m.valid_from AS validFrom, m.valid_to AS validTo, coalesce(m.invalidated, false) AS invalidated,
       e.id AS episode, e.agent AS agent, prev.id AS supersedes
ORDER BY ns, key, validFrom
```

**`view.sessions`** (read): All sessions in time order.

```cypher
MATCH (s:Session) RETURN s.id AS id, s.label AS label, s.t AS t ORDER BY s.t
```

### inspect

**`inspect.edges`** (read): Every relationship by endpoint ids, for graph hashing and debugging.

```cypher
MATCH (a)-[r]->(b) RETURN type(r) AS type, a.id AS from, b.id AS to, properties(r) AS props
```

**`inspect.nodes`** (read): Every node with its labels and properties, for graph hashing and debugging.

```cypher
MATCH (n) RETURN labels(n) AS labels, properties(n) AS props
```

### demo

**`demo.copiedAt`** (read): When a visitor copy was made.

```cypher
OPTIONAL MATCH (m:Meta {id: 'meta'}) RETURN m.copied_at AS at
```

**`demo.stampCopy`** (write): Record when a visitor copy was made, for the sweep.

```cypher
MATCH (m:Meta {id: 'meta'}) SET m.copied_at = $now RETURN count(m) AS n
```

<!-- queries:end -->
