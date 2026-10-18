# Deploying to Railway

Two services in one Railway project, talking over the private network:

```text
browser ──https──▶ web (this repo's Dockerfile, Next 16, port 3000)
                     │  falkordb.railway.internal:6379, password auth
                     ▼
                  falkordb (falkordb/falkordb:6.0.2, volume at /var/lib/falkordb/data, no public port)
```

On every boot `web` loads any tenant graph that is not ready (`pnpm replay --if-missing`), then starts Next.
Private networking only exists at runtime, which is why loading happens in the start command and not the build.

Everything below was rehearsed locally with the same image, a password-protected FalkorDB, an empty volume
(cold boot), a restart (warm boot, AOF persistence) and a wrong password (fails fast with `WRONGPASS`).

## 0. Before you start

- A Railway account on the Hobby plan or above (FalkorDB wants about 1 GB of RAM; the trial is tight).
- The code on a **public** GitHub repo (a submission requirement anyway):

  ```sh
  gh auth login                                   # once
  gh repo create quarantine --public --source . --push
  ```

  CI runs on the first push: typecheck, lint, format, README check, smoke, tests and eval on both engines.

- A strong password for FalkorDB: `openssl rand -hex 24`. Keep it for step 2.

## 1. Create the project

Railway dashboard → **New Project** → **Empty Project**. Name it `quarantine`.

## 2. FalkorDB service

1. On the canvas: **Create** → **Docker Image** → `falkordb/falkordb:6.0.2`.
2. Rename the service to exactly **`falkordb`** (Settings → service name). Its private hostname becomes
   `falkordb.railway.internal`, which the web service refers to below.
3. **Variables** (Raw Editor), pasting your password into the first line:

   ```env
   FALKORDB_PASSWORD=<openssl output>
   REDIS_ARGS=--requirepass ${{FALKORDB_PASSWORD}} --appendonly yes
   FALKORDB_ARGS=MAX_QUEUED_QUERIES 25 RESULTSET_SIZE 10000 TIMEOUT_DEFAULT 5000
   BROWSER=0
   ```

   - `REDIS_ARGS` is how this image takes a password, and `--appendonly yes` makes every write durable on the
     volume instead of relying on periodic snapshots.
   - `FALKORDB_ARGS` matches `docker-compose.yml`. `TIMEOUT_DEFAULT` is a backstop; every query also sets its
     own `TIMEOUT`.
   - `BROWSER=0` turns off the FalkorDB Browser that the image starts on port 3000. Nothing should reach the
     database from outside.

4. **Volume**: right-click the canvas (or ⌘K) → **Volume** → attach it to `falkordb` with mount path
   **`/var/lib/falkordb/data`**. The image's entrypoint takes ownership of the empty volume on first boot.
5. **Networking**: leave it private. Do not generate a domain or add a TCP proxy.
6. Deploy. The logs should end with `Ready to accept connections`. Redis binds `* -::*`, so it works on both
   dual-stack environments and older IPv6-only ones.

## 3. Web service

1. **Create** → **GitHub Repo** → pick the repo. Railway finds the root `Dockerfile` and `railway.json` (Docker
   build, health check on `/api/health` with a 120 s timeout, restart on failure).
2. **Variables**:

   ```env
   FALKORDB_HOST=${{falkordb.RAILWAY_PRIVATE_DOMAIN}}
   FALKORDB_PORT=6379
   FALKORDB_PASSWORD=${{falkordb.FALKORDB_PASSWORD}}
   PORT=3000
   ```

   Reference variables keep a single copy of the password on the `falkordb` service. No LLM keys are needed in
   production: the deployed app only replays recorded runs, and the LLM is only used by `pnpm record` and
   `pnpm sentinel` on your machine.

3. **Networking** → **Generate Domain**, target port **3000**.
4. **Replicas**: keep **one**. The query log ring buffer and the SSE subscribers live in process memory, and
   the scan rate limit is per process.
5. Deploy. The first boot logs:

   ```text
   load  tenant_acme  acme-attack1-seed  27 events  …ms  fa69faabacf3
   load  tenant_globex  globex-clean-seed  8 events  …ms  5d14618f475f
   ✓ Ready in …ms
   ```

   Later boots print `skip … (ready)`. The hashes match `pnpm replay` locally on either engine version.

## 4. Verify the live deployment

```sh
APP=https://<your-domain>.up.railway.app
J=$(mktemp)                                             # cookie jar: you get your own demo graph

curl -s $APP/api/health                                 # {"status":"ok", tenants acme + globex ready}
curl -s -c $J -b $J "$APP/api/incidents/acme-mem-sop-v4?mode=naive" | head -c 300
curl -s -N -c $J -b $J "$APP/api/incidents/acme-mem-sop-v4/stream" | head -5      # SSE rounds
PLAN=$(curl -s -c $J -b $J -X POST $APP/api/incidents/acme-mem-sop-v4/plans | jq -r .id)
curl -s -c $J -b $J -X POST $APP/api/plans/$PLAN/apply -d '{"confirm":true}' | jq '.reachAfter | length'   # 0
curl -s -c $J -b $J -X POST $APP/api/demo/reset         # back to the poisoned state for the next demo
curl -s -X POST $APP/api/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '[.result.tools[].name]'
```

Then open `$APP/debug` and click Reset, Temporal trace, Plan, Apply plan and Reach.

Anyone can point an MCP client at the deployment, for example Claude Code:
`claude mcp add --transport http quarantine $APP/api/mcp`. Each caller works on their own copy of the demo graph.

Finally put the URL in the README's "Live demo" line.

## 5. Updating

- **Code**: push to `main`; Railway rebuilds and redeploys `web`. Graphs on the volume are untouched.
- **Fixtures** (for example after `pnpm record` replaces the seed with a live run): `--if-missing` will not
  reload an existing graph, so set `REPLAY_FORCE=1` on `web`, redeploy, check the `load …` lines, then remove
  the variable. Visitors' existing demo copies keep the old data until they reset or the two-hour sweep removes
  them.
- **Engine**: change the image tag on `falkordb`. CI already proves the code on 6.0.2 and 4.22.1.

## Troubleshooting

| Symptom in `web` logs                       | Cause and fix                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `WRONGPASS invalid username-password pair`  | `FALKORDB_PASSWORD` on `web` does not match `REDIS_ARGS` on `falkordb`. Use the reference variable. |
| `NOAUTH Authentication required`            | `FALKORDB_PASSWORD` is unset on `web`.                                                              |
| `ENOTFOUND falkordb.railway.internal`       | The database service is not named `falkordb`, or it is in another environment.                      |
| `ECONNREFUSED` on boot, then a restart loop | FalkorDB is still starting or crashed; check its logs and memory.                                   |
| Health check times out                      | The boot replay is waiting on the database; same checks as above.                                   |
| `/api/health` says `degraded`               | The engine is up but a tenant graph is missing; redeploy with `REPLAY_FORCE=1`.                     |

Railway marks `railway.json` (config as code) as deprecated in favour of its newer infrastructure-as-code,
with existing files honoured until 2026-12-01. If it is ever ignored, the same settings live under the web
service's Settings tab: builder Dockerfile, health check path `/api/health`, restart policy on failure.
