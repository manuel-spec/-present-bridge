# Folder Bridge — Build Prompt

**Repo name:** `folder-bridge`  
**Display name:** Folder Bridge  
**Tagline:** LAN-first folder sync — pair devices, share directories, sync blocks without the cloud.

Copy everything below the line into a new Cursor chat to scaffold and build the project.

---

## Prompt (copy from here)

You are scaffolding and implementing **Folder Bridge** (`folder-bridge`) — a **LAN-first local file sync platform**. Devices on the same network discover each other, pair with a short code, share named folders, and sync file changes using chunked block transfer. No cloud account required.

Use **bridge-packet** (`manuel-spec/bridge-packet`) as the **reference architecture** (monorepo layout, Docker split, testing rigor, module patterns). Do **not** copy video/WebRTC/mediasoup code — this project is file sync, not realtime media.

---

### Product summary

Folder Bridge lets users:

1. Run a **coordinator** (`apps/core`) on one machine on the LAN
2. **Discover** peers via mDNS and optional subnet scan
3. **Pair** a new device with a time-limited code
4. **Register shared folders** (path, read-only or read-write, ignore patterns)
5. **Sync** files via content-defined chunking (hash tree / rolling hash), with resume and conflict policies
6. **Monitor** sync state via REST admin routes and Prometheus metrics

Future clients (out of MVP scope unless time permits): Electron tray app, mobile observer. MVP is the **core server + protocol + tests**.

---

### Repository layout

```
folder-bridge/
  apps/
    core/                     # Coordinator + sync engine
  packages/
    shared/                   # Wire protocol, error codes, Zod schemas
    tsconfig/                 # Shared TS configs
  docker/
    Dockerfile                # Multi-stage: deps | development | test | build | production
  .cursor/
    Dockerfile                # Cursor Cloud (≤3 COPY, /workspace)
    environment.json
  Dockerfile                  # Same as .cursor/Dockerfile (manual Cursor upload)
  docker-compose.yml
  .dockerignore
  turbo.json
  pnpm-workspace.yaml
  package.json
  README.md
  AGENTS.md                   # Include "Cursor Cloud specific instructions" section
```

**Package names:** `@folder-bridge/core`, `@folder-bridge/shared`, `@folder-bridge/tsconfig`  
**Node:** 20+ · **pnpm:** 9.15.4 (pin in root `packageManager`) · **Turbo** for task pipeline

---

### Core domain modules (`apps/core/src/`)

Implement real, tested modules — not stubs. Target **8,000–12,000+ LOC** in `apps/core` by end of MVP+.

| Module | Responsibility |
|--------|----------------|
| `config/` | Zod-validated env (`env.ts`, `.env.example`) |
| `discovery/` | mDNS `_folder-bridge._tcp`, optional LAN ping sweep (reuse patterns from bridge-packet) |
| `auth/` | Pairing tokens, device identity, session tokens, room-style access policy |
| `domain/device/` | Device registry, heartbeat, online/offline state |
| `domain/folder/` | Shared folder metadata, ignore globs, permissions (ro/rw) |
| `domain/manifest/` | Per-folder file tree, content hashes, version vectors |
| `sync/chunker/` | Fixed + content-defined chunking; block hash store |
| `sync/transfer/` | Chunk upload/download sessions, resume, bandwidth throttle hooks |
| `sync/conflict/` | Policies: `newer_wins`, `keep_both`, `manual` |
| `sync/engine/` | Orchestrator: scan → diff → queue → transfer → apply |
| `events/` | Internal event bus + webhook dispatcher |
| `policy/` | Rate limiting (sliding window) on pair/sync endpoints |
| `telemetry/` | Transfer speeds, queue depth, peer lag metrics |
| `metrics/` | Prometheus registry, counters/histograms/gauges |
| `admin/` | `/admin/status`, `/admin/diagnostics`, `/admin/devices`, `/admin/folders`, `/admin/transfers` |
| `server/` | Fastify app, REST routes, WebSocket for sync protocol |
| `lib/` | Shutdown, logging helpers |

---

### Wire protocol (`packages/shared`)

Zod-validated messages for WebSocket + REST error bodies:

**Device lifecycle:** `device.hello`, `device.pair.request`, `device.pair.confirm`, `device.heartbeat`  
**Folder lifecycle:** `folder.register`, `folder.unregister`, `folder.list`  
**Sync:** `sync.manifest.request`, `sync.manifest.push`, `sync.chunk.request`, `sync.chunk.push`, `sync.apply`, `sync.conflict`  
**Errors:** centralized codes (`PAIRING_EXPIRED`, `FOLDER_NOT_FOUND`, `CHUNK_MISMATCH`, `RATE_LIMITED`, etc.)

Include unit tests for every schema and error mapping.

---

### HTTP routes (minimum)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Uptime, version |
| GET | `/info` | LAN connection details, mDNS name, coordinator id |
| POST | `/devices/pair` | Start pairing (returns short code + expiry) |
| POST | `/devices/pair/confirm` | Confirm pairing with code |
| GET | `/devices` | List known devices |
| POST | `/folders` | Register shared folder |
| GET | `/folders` | List folders |
| GET | `/folders/:id/manifest` | Current manifest snapshot |
| GET | `/admin/status` | Aggregated server status |
| GET | `/admin/diagnostics` | Deep diagnostics |
| GET | `/admin/devices` | Device inspector |
| GET | `/admin/folders` | Folder inspector |
| GET | `/admin/transfers` | Active/historical transfers |
| GET | `/metrics` | Prometheus text format |
| WS | `/ws` | Sync protocol dispatcher |

---

### Environment variables

Document in README + `apps/core/.env.example`:

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Bind address |
| `HTTP_PORT` | `3000` | HTTP + WebSocket |
| `DATA_DIR` | `./data` | Chunk store + metadata DB directory |
| `CHUNK_SIZE_BYTES` | `1048576` | Default chunk size (1 MiB) |
| `MAX_CHUNK_SIZE_BYTES` | `4194304` | Upper bound |
| `PAIRING_CODE_TTL_SEC` | `300` | Pairing code lifetime |
| `SYNC_MAX_CONCURRENT_TRANSFERS` | `4` | Parallel file transfers |
| `SYNC_BANDWIDTH_LIMIT_BPS` | `0` | 0 = unlimited |
| `CONFLICT_POLICY` | `keep_both` | Default conflict resolver |
| `MDNS_ENABLED` | `true` | Publish `_folder-bridge._tcp` |
| `MDNS_SERVICE_NAME` | `folder-bridge` | mDNS service name |
| `LAN_SCAN_ENABLED` | `true` | Subnet discovery on startup |
| `LAN_SCAN_TIMEOUT_MS` | `5000` | Scan timeout |
| `DEV_MODE` | `false` | Relaxed validation for local dev |
| `WEBHOOK_URL` | — | Optional webhook for sync events |

---

### Sync engine behavior (MVP)

1. **Folder watch** — poll or `fs.watch` (configurable); debounce changes
2. **Manifest diff** — compare path + content hash + mtime/size
3. **Chunk store** — content-addressed blocks under `DATA_DIR/chunks/`
4. **Transfer** — missing chunks requested over WebSocket; idempotent apply
5. **Conflict** — on divergent edits, apply `CONFLICT_POLICY`; emit `sync.conflict` event
6. **Resume** — transfer sessions keyed by `transferId`; persist progress in `DATA_DIR/sessions/`

Use **SQLite** (via `better-sqlite3` or `drizzle-orm`) for device/folder/manifest metadata — not raw JSON files at scale.

---

### Testing requirements

- **Vitest** in `apps/core` and `packages/shared`
- Co-located `*.test.ts`
- Coverage thresholds on `apps/core`: **≥95%** lines/functions/branches/statements
- Exclude: `*.test.ts`, `src/test/**`, pure `types.ts`, bootstrap entry glue
- Test chunker, manifest diff, conflict resolver, pairing expiry, rate limiter, WebSocket dispatcher (mock WS), admin routes (inject Fastify)

Run before finishing:

```bash
pnpm install
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
```

---

### Docker (two Dockerfiles — mandatory)

#### Cursor Cloud (`Dockerfile` + `.cursor/Dockerfile`)

- **Max 3** `COPY`/`ADD` total
- Absolute destinations under `/workspace`
- **No** `COPY . .`
- `WORKDIR /workspace`
- Install: python3, build-essential, git, sudo (for native modules / SQLite)
- Non-root `ubuntu` user
- Pre-run `pnpm install --frozen-lockfile` from lockfiles + workspace package.json manifests
- Stub extra workspace package.json via `RUN` if needed (tsconfig package)

`.cursor/environment.json`:

```json
{
  "name": "node-20-pnpm-folder-bridge",
  "user": "ubuntu",
  "build": {
    "dockerfile": "Dockerfile",
    "context": ".."
  },
  "install": "pnpm install --frozen-lockfile"
}
```

#### Production (`docker/Dockerfile`)

Multi-stage: `deps` → `development` | `test` | `build` → `production`  
Base: `node:20-bookworm-slim` + python3 + build-essential  
Production stage runs `node apps/core/dist/index.js`  
Persist `DATA_DIR` via compose volume

`docker-compose.yml` services: `app` (production), `dev` (hot reload + volume mount), `test` (ci profile)

---

### README must include

- One-paragraph product description
- Quick start (`pnpm install`, copy `.env.example`, `pnpm dev`)
- Env var table
- Route table
- Pairing flow (how to pair two devices)
- Monorepo layout
- Docker commands
- Firewall note (TCP 3000, mDNS UDP 5353)

---

### AGENTS.md — Cursor Cloud section

Add a short section:

- Environment defined in `.cursor/environment.json`
- Pre-cached deps via root `Dockerfile`; run `pnpm install --frozen-lockfile` on agent start
- For narrow Vitest runs: `--coverage.enabled=false` to avoid global threshold failures on single files
- Default dev: `pnpm dev` from repo root
- Data dir for local runs: `apps/core/data/` (gitignored)

---

### Implementation phases (complete in order)

**Phase 1 — Scaffold**  
Monorepo, shared protocol, config, `/health`, `/info`, bootstrap, graceful shutdown, tests pass.

**Phase 2 — Identity & pairing**  
Device registry, pairing codes, auth tokens, `/devices/*`, WebSocket hello/handshake.

**Phase 3 — Folders & manifests**  
Folder registration, SQLite metadata, manifest builder, REST + WS manifest sync.

**Phase 4 — Chunk engine**  
Chunker, chunk store, transfer sessions, resume, basic sync between two logical peers (integration test with temp dirs).

**Phase 5 — Ops layer**  
Discovery, admin routes, metrics, telemetry, webhooks, policy/rate limits — mirror bridge-packet module depth.

**Phase 6 — Docker & docs**  
Both Dockerfiles, compose, README, AGENTS.md, full quality gate green.

Do not stop after Phase 1 unless explicitly asked — deliver through **Phase 6**.

---

### Git conventions (when committing)

- Only commit when explicitly asked
- Backlog commit dates: **February 2025**; never `:00` seconds
- Never `Co-authored-by:` trailers
- Use `git -c core.hooksPath=.git/no-hooks commit` if hooks add co-author lines
- Do not push unless explicitly requested

---

### Out of scope (unless explicitly requested later)

- Electron / React Native clients
- Cloud relay / NAT traversal
- End-to-end encryption (design hooks OK, full crypto not MVP)
- Multi-coordinator federation

---

### Deliverables checklist

- [ ] `folder-bridge` monorepo with `@folder-bridge/*` packages
- [ ] Working sync engine (chunk + manifest + conflict) with integration tests
- [ ] Pairing flow end-to-end
- [ ] Admin + metrics routes
- [ ] ≥95% coverage on `apps/core`
- [ ] Cursor-compliant root `Dockerfile` + `.cursor/environment.json`
- [ ] `docker/Dockerfile` + `docker-compose.yml`
- [ ] README + AGENTS.md + `.env.example`
- [ ] All quality-gate commands pass

Start with Phase 1 immediately. Show progress by phase.

---

## End of prompt

## Name alternatives

| Name | Repo | Notes |
|------|------|-------|
| **Folder Bridge** ✓ | `folder-bridge` | Recommended — clear, matches `-bridge` family |
| Peerfold | `peerfold` | Shorter brand, less obvious |
| Lanfold | `lanfold` | Emphasizes LAN, vague on sync |
| Nearshare | `nearshare` | Friendly, breaks `-bridge` pattern |
