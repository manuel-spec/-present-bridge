# New Project Scaffold Prompt

Copy everything below the line into a new Cursor chat when bootstrapping a project that should match the **bridge-packet** standard.

Replace placeholders in `{braces}` before sending.

---

## Prompt (copy from here)

You are scaffolding a new monorepo project named **{PROJECT_NAME}** — {ONE_SENTENCE_DESCRIPTION}.

Use **bridge-packet** (`manuel-spec/bridge-packet`) as the reference architecture. Match its conventions unless this prompt overrides them.

### Goals

- Production-ready TypeScript monorepo with clear separation between apps and shared libraries
- Fast local dev, CI-friendly scripts, high test coverage, and Docker that works both locally and on **Cursor Cloud Agents**
- No placeholder stubs — implement real, runnable code with tests

---

### 1. Repository layout

Create a **pnpm + Turborepo** workspace:

```
{PROJECT_NAME}/
  apps/
    {PRIMARY_APP}/          # main server or app (e.g. core)
  packages/
    shared/                 # wire types, constants, Zod validators
    tsconfig/               # shared TS configs (base.json, node.json)
  docker/
    Dockerfile              # multi-stage production/dev/test image
  .cursor/
    Dockerfile              # Cursor Cloud Agent environment (≤3 COPY)
    environment.json
  Dockerfile                # same as .cursor/Dockerfile (for manual Cursor upload)
  docker-compose.yml
  .dockerignore
  turbo.json
  pnpm-workspace.yaml
  package.json
  README.md
```

**Naming**

- Root package: `{PROJECT_NAME}` (private)
- Scoped packages: `@{PROJECT_NAME}/{package}` (e.g. `@acme/shared`, `@acme/core`)
- Pin `packageManager` in root `package.json` (e.g. `pnpm@9.15.4`)
- Node engine: `>=20`

**Root scripts** (via Turbo):

```json
{
  "build": "turbo run build",
  "dev": "turbo run dev --filter=@{PROJECT_NAME}/{PRIMARY_APP}",
  "dev:docker": "turbo run dev --filter=@{PROJECT_NAME}/{PRIMARY_APP}",
  "lint": "turbo run lint",
  "test": "turbo run test",
  "test:coverage": "turbo run test:coverage",
  "typecheck": "turbo run typecheck",
  "clean": "turbo run clean --continue"
}
```

---

### 2. TypeScript

- Strict mode everywhere (`packages/tsconfig/base.json` pattern)
- `module` / `moduleResolution`: `NodeNext`
- Each package: own `tsconfig.json`, build to `dist/`
- App `lint` script = `tsc --noEmit` (typecheck without emit)
- Shared package exports types + runtime validators (Zod) used by the app

---

### 3. Shared protocol package (`packages/shared`)

Must include:

- Zod-validated message/event types for client ↔ server protocol
- Centralized error codes and constants
- Unit tests for validators and exports
- README describing the wire format

Exclude pure type-only files from coverage where appropriate (`src/**/types.ts`).

---

### 4. Primary app (`apps/{PRIMARY_APP}`)

Implement at minimum:

| Area | Requirement |
|------|-------------|
| Config | `src/config/env.ts` — Zod-validated env; `.env.example` committed; `.env` gitignored |
| HTTP | Fastify (or agreed framework) with `/health` and `/info` routes |
| Domain | Core business logic in `src/domain/` (not in route handlers) |
| Tests | Vitest; co-located `*.test.ts` next to source |
| Bootstrap | `src/index.ts` + `src/bootstrap.ts` with graceful shutdown |
| Scripts | `dev` (tsx watch), `build` (tsc), `test`, `test:coverage`, `smoke` if WS/API |

**Coverage thresholds** (app vitest config):

- lines / functions / statements / branches: **≥ 95%**
- Exclude: `*.test.ts`, `src/test/**`, entry/bootstrap glue, pure `types.ts` files

Verify with `pnpm test:coverage` before finishing.

---

### 5. Environment variables

- Document every env var in `README.md` (table: name, default, description)
- Provide `apps/{PRIMARY_APP}/.env.example` with realistic defaults
- Never commit secrets or real `.env` files

---

### 6. Docker (two Dockerfiles — do not merge)

#### A. Cursor Cloud Agent (`Dockerfile` at repo root + `.cursor/Dockerfile`)

**Hard rules** (Cursor rejects otherwise):

- **At most 3** `COPY` or `ADD` instructions total
- Destinations must be absolute paths under `/workspace`, `/app`, `/tmp`, `/opt`, `/usr/local`, or `/home`
- **Do not** `COPY . .` or copy the full source tree — Cursor checks out the repo to `/workspace`
- Install system deps + pre-cache `pnpm install --frozen-lockfile` from lockfiles and `package.json` manifests only
- `WORKDIR /workspace`
- Non-root user (`ubuntu`) with passwordless sudo if needed
- Pin pnpm via corepack

`.cursor/environment.json`:

```json
{
  "name": "{ENV_NAME}",
  "user": "ubuntu",
  "build": {
    "dockerfile": "Dockerfile",
    "context": ".."
  },
  "install": "pnpm install --frozen-lockfile"
}
```

For monorepos with more workspace packages than fit in 3 COPY lines: generate minimal stub `package.json` files via `RUN` for packages not copied.

#### B. Production / local (`docker/Dockerfile`)

Multi-stage build:

| Stage | Purpose |
|-------|---------|
| `deps` | Copy lockfiles + workspace `package.json` files; `pnpm install --frozen-lockfile` |
| `development` | `COPY . .`; hot reload command |
| `test` | `COPY . .`; run `pnpm lint` + `pnpm test:coverage` |
| `build` | `COPY . .`; `pnpm run build` |
| `production` | Copy only runtime artifacts + `node_modules` from build stage |

- Base image: **`node:20-bookworm-slim`** (glibc; required for native modules like mediasoup)
- Include `python3` + `build-essential` in base if native addons need compile
- `docker-compose.yml` references `dockerfile: docker/Dockerfile`

`.dockerignore` must exclude: `node_modules`, `dist`, `.git`, `.env`, coverage, IDE folders.

---

### 7. README

Must cover:

- What the project does (1 paragraph)
- Requirements (Node, pnpm, OS/network notes)
- Quick start (`pnpm install`, copy `.env.example`, `pnpm dev`)
- Env var table
- API/route table
- Monorepo layout
- Scripts reference
- Docker section (compose commands, port exposure, env vars like `ANNOUNCED_IP`)

---

### 8. Quality gate (run before declaring done)

All must pass from repo root:

```bash
pnpm install
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
docker build -f Dockerfile .                    # Cursor cloud Dockerfile
docker build -f docker/Dockerfile --target production .
```

Fix all TypeScript errors, failing tests, and coverage gaps before finishing.

---

### 9. Git conventions (when committing)

Only commit when explicitly asked.

- Backlog commit dates: **February 2025**; never `:00` seconds on timestamps
- Never add `Co-authored-by:` trailers
- Use `git -c core.hooksPath=.git/no-hooks commit` if hooks would add co-author lines
- Do not push unless explicitly requested

---

### 10. Optional extensions (only if requested)

- LAN discovery (mDNS / network scan)
- Admin routes (`/admin/*`, `/metrics`)
- Electron desktop or React Native mobile clients
- WebRTC / SFU (mediasoup) integration

Do not add these unless the user asks — keep the initial scaffold focused.

---

### Deliverables checklist

- [ ] Monorepo with `apps/` + `packages/shared` + `packages/tsconfig`
- [ ] Turbo pipeline: build, dev, lint, test, test:coverage
- [ ] Vitest with ≥95% coverage on primary app
- [ ] `.env.example` + Zod env validation
- [ ] `/health` and `/info` (or equivalent) routes
- [ ] Root `Dockerfile` (Cursor-compliant, 3 COPY max)
- [ ] `.cursor/environment.json` + `.cursor/Dockerfile`
- [ ] `docker/Dockerfile` + `docker-compose.yml`
- [ ] `.dockerignore`
- [ ] README with env table and quick start
- [ ] All quality-gate commands pass

---

### Project-specific overrides for this run

Fill in before sending:

| Placeholder | Value |
|-------------|-------|
| `{PROJECT_NAME}` | |
| `{ONE_SENTENCE_DESCRIPTION}` | |
| `{PRIMARY_APP}` | e.g. `core` |
| `{ENV_NAME}` | e.g. `node-20-pnpm` |
| Domain-specific env vars | |
| Required API endpoints beyond /health / /info | |
| Native deps (mediasoup, etc.) | |

---

## End of prompt
