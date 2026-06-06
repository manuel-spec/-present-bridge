# @bridge-packet/core

Node.js SFU signaling server for Bridge Packet. Handles WebRTC media routing via mediasoup, WebSocket signaling, REST room management, and LAN discovery.

## Development

```bash
cp .env.example .env
pnpm --filter @bridge-packet/core dev
```

## Smoke test

With the server running:

```bash
pnpm --filter @bridge-packet/core smoke
```
