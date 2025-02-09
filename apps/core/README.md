# @packet-bridge/core

Node.js SFU signaling server for Packet Bridge. Handles WebRTC media routing via mediasoup, WebSocket signaling, REST room management, and LAN discovery.

## Development

```bash
cp .env.example .env
pnpm --filter @packet-bridge/core dev
```

## Smoke test

With the server running:

```bash
pnpm --filter @packet-bridge/core smoke
```
