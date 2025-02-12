import type { Env } from "../config/env.js";
import { vi } from "vitest";
import WebSocket from "ws";

export function createTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    host: "0.0.0.0",
    httpPort: 0,
    announcedIp: "127.0.0.1",
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    mediasoupWorkerCount: 1,
    mdnsEnabled: false,
    mdnsServiceName: "packet-bridge",
    devMode: true,
    wsPath: "/ws",
    version: "0.1.0",
    ...overrides,
  };
}

export interface MockSocketHandlers {
  onMessage?: (data: WebSocket.RawData) => void;
  onClose?: () => void;
}

export function createMockSocket(handlers: MockSocketHandlers = {}): WebSocket {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const socket = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
      if (event === "message" && handlers.onMessage) {
        handlers.onMessage = handlers.onMessage;
      }
      if (event === "close" && handlers.onClose) {
        handlers.onClose = handlers.onClose;
      }
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of listeners.get(event) ?? []) {
        handler(...args);
      }
    },
  } as unknown as WebSocket;

  return socket;
}

export function createMockMediasoupTransport(id = "transport-1") {
  return {
    id,
    iceParameters: { iceLite: true },
    iceCandidates: [{ foundation: "1" }],
    dtlsParameters: { role: "auto" },
    connect: vi.fn().mockResolvedValue(undefined),
    produce: vi.fn().mockResolvedValue({ id: "producer-1", kind: "video" }),
    consume: vi.fn().mockResolvedValue({
      id: "consumer-1",
      kind: "video",
      rtpParameters: { codecs: [] },
      resume: vi.fn().mockResolvedValue(undefined),
    }),
    close: vi.fn(),
  };
}

export function createMockRouter(roomId = "room-1") {
  const transport = createMockMediasoupTransport();
  return {
    rtpCapabilities: { codecs: [{ mimeType: "video/VP8" }] },
    createWebRtcTransport: vi.fn().mockResolvedValue(transport),
    canConsume: vi.fn().mockReturnValue(true),
    close: vi.fn(),
    roomId,
  };
}

export function createMockWorker() {
  const router = createMockRouter();
  return {
    pid: 12345,
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    createRouter: vi.fn().mockResolvedValue(router),
  };
}

export function parseSentMessages(socket: WebSocket): unknown[] {
  const send = socket.send as ReturnType<typeof vi.fn>;
  return send.mock.calls.map(([payload]) => JSON.parse(String(payload)));
}

export function findMessageByType(messages: unknown[], type: string): Record<string, unknown> | undefined {
  return messages.find((message) => (message as { type: string }).type === type) as
    | Record<string, unknown>
    | undefined;
}
