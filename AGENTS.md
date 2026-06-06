# Cursor Cloud specific instructions

- Environment config lives in `.cursor/environment.json` (Node 20, pnpm 9.15.4, mediasoup native deps).
- The root `Dockerfile` is for Cursor Cloud only (≤3 COPY, `/workspace`). Production Docker uses `docker/Dockerfile`.
- After checkout, run `pnpm install --frozen-lockfile` then verify with `pnpm test:coverage`.
- Required env for local/core runs: copy `apps/core/.env.example` to `apps/core/.env` and set `ANNOUNCED_IP` (use `127.0.0.1` with `DEV_MODE=true` in cloud VMs).
- Dev server: `pnpm dev` from repo root.
- For focused Vitest runs without global thresholds: `pnpm exec vitest --run --coverage.enabled=false apps/core/src/...`

## Verification commands

| Action | Command |
|--------|---------|
| Install | `pnpm install --frozen-lockfile` |
| Lint | `pnpm lint` |
| Tests + coverage gate (≥95%) | `pnpm test:coverage` |
| Build | `pnpm build` |
| Full verify | `pnpm lint && pnpm test:coverage && pnpm build` |

Coverage thresholds are enforced in `apps/core/vitest.config.ts` and `packages/shared/vitest.config.ts`.
