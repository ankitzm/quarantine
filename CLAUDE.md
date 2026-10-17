# Quarantine

Memory-poisoning incident response for multi-agent swarms. Graph Hacks, tracks 01 and 02.

A poisoned memory write spreads through a LangGraph swarm: agents read it, hand off, decide on it, call tools.
Quarantine records every step as a graph in FalkorDB, traces the infection **forward in time**, computes what
infected agents can reach through MCP tools and credentials, and cuts that reach with the **minimum-cost set of
revocations** (`algo.maxFlow` + residual-graph cut). The graph decides every outcome. The LLM only narrates and
chooses tools.

## Hard rules

- **The graph decides.** Infection, reach and the cut come from Cypher + deterministic TS. Never from an LLM.
- **`run()` is the only path to the database.** Every query lives in the registry (`packages/graph/src/queries`).
- **Reads use `roQuery`.** Every query has a `TIMEOUT`.
- **Writes are `MERGE` on stable ids** (content hashes). Replaying the same events twice yields the same graph.
- **Nothing is deleted.** Revocation sets `revoked_at` and `capacity: 0`; supersession sets `valid_to`.
- **Env values are never stored.** Config parsing keeps names only and drops values immediately.
- **Exfiltration is stubbed.** Fetch only resolves allowlisted fixture pages; everything else is logged and stubbed.
- **The LLM gets no Cypher and no DB credentials.** MCP read tools are read-only; apply requires `confirm=true`.
- **Verify library APIs in `node_modules` types before use.** Do not trust memory for versioned APIs.

## Layout

```
apps/web/                 Next 16 app: route handlers, /debug page, mocks/
packages/graph/src/
  client.ts               FalkorDB connection
  run.ts                  run(): registry lookup, roQuery/query, TIMEOUT, ring buffer, redacted params
  queries/*.ts            { name, description, cypher, mode } registry
  schema.ts               indexes + Meta ready flag
  ingest.ts               applyEvents(graph, events): the single write path
  trace.ts                temporal (earliest-arrival) + naive BFS trace
  permissions/            MCP config parser, manifests, sensitivity, reach, min-cut, applyQuarantine
  types/api.ts            zod API contract
  api/*.ts                pure response builders (graph, input) -> response
fixtures/runs/            event logs (seed + live recordings)
fixtures/configs/<tenant> per-agent *.mcp.json
scripts/                  smoke, replay, mocks, record, eval, bench
```

## Graph model

Nodes: `Session`, `Agent`, `Episode`, `Input`, `MemoryItem {ns, key, kind, valid_from, valid_to, invalidated}`,
`Decision`, `Tool`, `Credential`, `CredCut`, `Resource`, `Meta`.

Edges: `WROTE`, `READ`, `DERIVED_FROM`, `SUPERSEDES`, `HANDED_OFF {summary}`, `DECIDED`, `BASED_ON`, `CALLED`,
`CAN_USE`, `USES_CRED`, `CRED_CUT`, `GRANTS`, `ACTS_ON`. Permission edges carry `capacity`, `cost`, `revocable`,
`revoked_at`.

Memory kinds by namespace: `sop` = procedural, `customer` = semantic, `episodes` = episodic.

Deviations from the brief:
1. `algo.maxFlow` only filters by relationship type, so revocation sets `capacity: 0` (keeping `cost`) instead of
   deleting. Reach filters `revoked_at IS NULL`.
2. Credentialed tools reach resources via `USES_CRED -> CRED_CUT -> GRANTS`; credential-less tools use `ACTS_ON`.
   Without the split, rotating a credential could never cut anything.
3. Next 16: route handler `params` is a Promise.
4. API tests call route handlers directly (no supertest).
5. FalkorDB Browser (container port 3000) maps to host 3001.

## Event flow

Live swarm / seed fixture / eval generator / scan -> events -> `applyEvents` -> graph.
Event types: Session, Episode, Input, MemoryWrite, MemoryRead, Supersede, Handoff, Decision, ToolCall,
PermissionConfig. Times are integer epoch ms; live mode injects `now()`.

## Commands

```
pnpm dev         # next dev
pnpm typecheck   # tsc --noEmit across workspace
pnpm lint        # eslint
pnpm test        # vitest (integration tests need FalkorDB up)
pnpm smoke       # engine capability smoke test
pnpm replay      # load fixtures into fresh graphs
pnpm mocks       # regenerate apps/web/mocks/*.json from builders
pnpm record      # live OpenRouter runs -> fixtures/runs/live
pnpm eval        # temporal vs naive, min-cut vs brute force
pnpm bench       # concurrency benchmark per engine version
docker compose up -d                  # primary engine
docker compose --profile v4 up -d     # alternate engine on 6380
```

## Conventions

- TypeScript strict ESM, zod at every boundary, typed errors (`GraphNotReady`, `QueryTimeout`, `PlanNotFound`,
  `ConfirmRequired`).
- Small conventional commits (`feat(graph): ...`), each green on typecheck, lint, test.
- No secrets in logs; query params are redacted in the ring buffer.

## Milestones

M0 scaffold + smoke matrix -> M1 graph core -> seed fixture -> M4 trace -> M5 permissions -> /debug -> API
contract + mocks -> M2 FalkorDBStore -> live recording -> M6 MCP + Sentinel -> M7 full API -> M8 eval, bench,
README, Railway.

Cut order if late: Attack 2, then `/api/scan`, then vector index (already cut). Never cut the temporal trace,
min-cut correctness, replay determinism, the eval or the query log.
