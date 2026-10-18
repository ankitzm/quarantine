# UI brief

## What we are closest to

Quarantine is an incident-response console for agents. The products nearest to it, and what each gets right and
wrong for our case:

| Product                                                              | What we take                                                                                                                                 | Where it stops short                                                                                                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BloodHound** (attack paths in Active Directory)                    | The core idea: paths from a compromised principal to high-value targets, and "remove these edges to break them". This is our reach plus cut. | The graph is a static snapshot with no time, so it cannot say who is infected _now_. Fixes are ranked heuristically, not as a provably cheapest set. And the default view is a hairball. |
| **CrowdStrike / SentinelOne "Storyline"** (endpoint infection trees) | One story from patient zero outwards, every step attributed, and a single "remediate / roll back" action.                                    | It is per process tree. It has no notion of shared memory versions or of agents handing work to each other.                                                                              |
| **Wiz Security Graph** (cloud blast radius)                          | Blast-radius framing, "toxic combinations", and showing exposure as a count that should reach zero.                                          | Its fixes are a to-do list. Nothing is optimised, and nothing is applied in place.                                                                                                       |
| **LangSmith / Langfuse / Arize Phoenix** (agent traces)              | The swimlane and waterfall of agent steps, and inspecting tool calls.                                                                        | Each run is a silo. You cannot follow a poisoned memory _across_ runs and agents, which is exactly where the attack lives.                                                               |
| **GitHub diff / time travel**                                        | Version history of a memory key, with the injected text shown as a diff.                                                                     | Nothing to beat here. Just borrow it.                                                                                                                                                    |

**Our position: "Storyline + BloodHound for agent swarms, with time and an optimal fix."** We win on four
things none of them have together, and the UI has to make each one visible in seconds:

1. **Time is correct.** The temporal trace beats the naive trace on screen: the naive trace's false positives
   (Analytics read the _real_ SOP an hour earlier) appear as ghosts that the temporal trace leaves out. Put the
   count on screen (eval: naive precision 0.55, temporal 1.00).
2. **The fix is provably cheapest.** Show the cut as a small set of "scissors" on edges, with a badge that reads
   "cost 29 = max flow 29 = exhaustive optimum". Every revocation cites the config file and line it came from.
3. **Remediation covers memory, not just access.** Apply revokes the access, invalidates the poison and
   everything derived from it, and restores SOP v3 as v5. Show it as a diff.
4. **The graph decides, and you can see it.** Every number links to the Cypher that produced it, through the
   live query log. The LLM only narrates.

## What we built instead of the first layout

The first Stitch layout put storyline, blast radius, plan and drawer on one screen. It was accurate but
overloaded, so the shipped console uses progressive disclosure:

- **One sentence states the case** (who, what, when, how far). There are no stat cards; the numbers live in
  the sentence.
- **Three steps, one view at a time:** Spread, Reach, Contain. This is a real sequence, so the steps are
  numbered. The open step is kept in `?step=`.
- **Spread:** a contact-tracing chart with lanes ordered by infection, memory versions on top, and labels only
  on hover, tap or focus. Ghosts appear only when "Compare with a time-blind trace" is ticked.
- **Reach:** the permission network in four columns, ordered by barycentre to keep crossings low. Hover a node
  to follow its paths.
- **Contain:** quarantine tape on the cut, the revocations with their config sources, then a confirmation
  dialog. After apply, reach counts down to 0 and the clean and poisoned versions sit side by side, with the
  exfiltration URL marked.
- **Queries** open in a side sheet on request, scoped to the visitor's graph.

Tokens are in `apps/web/app/globals.css`. Components are in `apps/web/components/console`. Pure layout logic,
tested against the mocks, is in `apps/web/lib/console/derive.ts`.

## Original layout sketch (superseded)

## Layout: one screen, three linked panes, one clock

```text
┌ Incident #4471 · acme ─────────────── [Temporal | Naive]  ▶ replay   Reset demo ┐
│ ① Storyline (agent swimlanes over time)                                          │
│   researcher ●──fetch──✎sop v4──────▶ handoff                                   │
│   billing            ◉ read v4 ── decide ── refund ✎note ─▶                     │
│   ops                                       ◉ decide ── POST audit-sync ✕        │
│   analytics ○ read v3 (ghost in naive)                       ··· ◉ read note    │
│   ───────────── time scrubber (← →) ─────────────────────────────────────────── │
├──────────────────────────────────────┬───────────────────────────────────────────┤
│ ② Spread                             │ ③ Blast radius and cut                     │
│ patient zero ▶ round 1 ▶ round 2 …   │ agents → tools → credentials → resources  │
│ episodes + memory versions, layered  │ (layered, left to right, never a hairball) │
│ left to right by infection time      │ ✂ 8 revocations · cost 29 · optimal ✓     │
│                                      │ [Review plan] → [Apply, confirm] → reach 0 │
├──────────────────────────────────────┴───────────────────────────────────────────┤
│ ④ drawer: Memory diff (v3 → v4 poison → v5 restored) · Cypher log (live) · Sentinel report │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- **One clock.** The scrubber drives all three panes. Scrubbing to 10:02 shows only what was infected by 10:02.
  Arrow keys step one event at a time.
- **Temporal | Naive toggle.** Naive adds dashed "ghost" nodes and events with a small "false positive" tag.
  Never recolour the real infection.
- **The spread animates once**, from `/api/incidents/:seed/stream`: round 0 is patient zero, then each round
  lights its nodes with a short stagger. Under `prefers-reduced-motion`, show the final state straight away.
- **The cut pane** lays out nodes in columns (Agent, Tool, Credential, Resource) so the cut reads as a vertical
  line of scissors. Choosing a revocation highlights the paths it breaks, its cost, and its `source` citation.
- **Apply** needs an explicit confirm (the API requires `confirm: true`). After it, reach animates down to 0, the
  memory diff shows v5 superseding the poison, and the timeline marks the quarantine episode.

## Data: every pane already has an endpoint and a mock

| Pane                   | Endpoint                                                          | Mock in `apps/web/mocks/`                       |
| ---------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| Header, toggle         | `GET /api/incidents/:seed?mode=` (`naiveFalsePositives`)          | `incident.temporal.json`, `incident.naive.json` |
| ① Storyline            | `GET /api/incidents/:seed/timeline` (`isInfected`, `isNaiveOnly`) | `timeline.json`                                 |
| ② Spread animation     | `GET /api/incidents/:seed/stream` (SSE)                           | `sse.trace.json`                                |
| ③ Reach                | `GET /api/incidents/:seed/reach`                                  | `reach.json`, `reach.after.json`                |
| ③ Plan, apply          | `POST /api/incidents/:seed/plans`, `POST /api/plans/:id/apply`    | `plan.json`, `apply.json`                       |
| ④ Memory diff          | `GET /api/memory?q=`                                              | `memory.json`, `memory.after.json`              |
| ④ Cypher log           | `GET /api/queries/stream` (SSE)                                   | `sse.queries.json`                              |
| Proof strip            | `GET /api/eval`                                                   | `eval.json`                                     |
| Try it on your configs | `POST /api/scan`                                                  | `scan.json`                                     |
| Reset                  | `POST /api/demo/reset`                                            | `demo.reset.json`                               |

The types are in `packages/graph/src/types/api.ts`. Errors always have the shape `{ error: { code, message } }`.
The seed for the demo is `acme-mem-sop-v4`.

## Visual direction

- **Dark and restrained.** Near-black surfaces, one accent for infection (a warm red-orange), a muted cyan
  for "safe / restored", and grey for ghosts. Status never relies on colour alone: infected nodes are solid,
  ghosts are dashed, and restored items carry a check.
- **Type.** A clean sans for prose. Monospace for ids, Cypher, times and costs, with tabular numbers.
- **Motion has a job or does not exist.** Spread stagger is about 120 ms per round, and the reach count ticks
  down after apply. No ambient animation, no glassmorphism, no gradients on data.
- **Density over decoration.** This is an operator console. Use 13–14 px body text and make every pixel
  inspectable on hover: id, timestamp, the edge that caused it.
- **First 10 seconds of the demo video:** the poisoned page, then the spread animating, then the naive ghosts
  appearing and disappearing with the toggle, then scissors and "optimal ✓", then apply, then reach 0. Design
  for that sequence.

The UI session should apply the `emil-design-eng`, `web-design-guidelines` and `frontend-ui-engineering` skills.
It should also keep `/debug` as the raw console, linked from the footer.
