# Packet Bridge

LAN multi-platform video chat platform. The core server is a Node.js SFU built with mediasoup; desktop (Electron + React) and mobile (React Native) clients connect over the local network.

## Requirements

- Node.js 20+
- pnpm 9+
- Windows/macOS/Linux with UDP ports open for WebRTC

## Quick start

```bash
pnpm install
cp apps/core/.env.example apps/core/.env
# Set ANNOUNCED_IP to your LAN IP address
pnpm dev
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | HTTP/WebSocket bind address |
| `HTTP_PORT` | `3000` | REST and WebSocket port |
| `ANNOUNCED_IP` | — | LAN IP sent to WebRTC clients (required) |
| `RTC_MIN_PORT` | `40000` | mediasoup RTC range start |
| `RTC_MAX_PORT` | `49999` | mediasoup RTC range end |
| `MEDIASOUP_WORKER_COUNT` | CPU count | mediasoup worker processes |
| `MDNS_ENABLED` | `true` | Publish `_packet-bridge._tcp` on LAN |
| `MDNS_SERVICE_NAME` | `packet-bridge` | mDNS service name |
| `DEV_MODE` | `false` | Allow missing `ANNOUNCED_IP` (localhost only) |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health and uptime |
| GET | `/info` | Connection details for manual client setup |
| POST | `/rooms` | Create a room |
| GET | `/rooms` | List active rooms |
| GET | `/rooms/:roomId` | Room metadata |
| WS | `/ws` | Signaling channel |

## LAN discovery

When `MDNS_ENABLED=true`, the server advertises `_packet-bridge._tcp` with TXT records (`path`, `version`, `announcedIp`). Clients can also call `GET /info` or connect manually via `ws://<lan-ip>:3000/ws`.

## Firewall

Allow inbound TCP on `HTTP_PORT` and UDP/TCP on `RTC_MIN_PORT`–`RTC_MAX_PORT`.

## Monorepo layout

```
apps/core          Node SFU + signaling server
packages/shared    Wire protocol types and validators
packages/tsconfig  Shared TypeScript configs
```

## Scripts

```bash
pnpm dev      # Start core server in watch mode
pnpm build    # Build all packages
pnpm test     # Run tests
pnpm lint     # Typecheck all packages
```

## Docker

Multi-stage image matching the project layout: `deps` → `development` | `test` | `build` → `production`.

```bash
# Production core server (set your LAN IP for WebRTC)
ANNOUNCED_IP=192.168.1.100 docker compose up app --build

# Development with live reload
ANNOUNCED_IP=192.168.1.100 docker compose up dev --build

# CI test stage (lint + coverage)
docker compose --profile ci build test
```

| Stage | Target | Purpose |
|-------|--------|---------|
| `development` | `dev` service | Hot reload via `pnpm dev:docker` |
| `test` | `test` service | Runs `pnpm lint` and `pnpm test:coverage` |
| `production` | `app` service | Runs built core server on port `3000` |

Expose TCP `3000` and UDP/TCP `40000–49999` for mediasoup WebRTC. Set `ANNOUNCED_IP` to the IP clients use to reach the host (not `127.0.0.1` for real LAN devices).
