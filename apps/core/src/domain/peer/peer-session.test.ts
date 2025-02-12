import { describe, expect, it, vi } from "vitest";
import { PeerSession } from "./peer-session.js";
import { WebSocket } from "ws";

describe("PeerSession", () => {
  it("tracks peer identity and sends JSON over open socket", () => {
    const messages: string[] = [];
    const socket = {
      readyState: WebSocket.OPEN,
      send: (data: string) => messages.push(data),
    } as unknown as WebSocket;

    const session = new PeerSession("peer-1", "Alice", socket);
    session.send({ type: "room.joined", payload: {} });

    expect(session.peerId).toBe("peer-1");
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0]!)).toEqual({ type: "room.joined", payload: {} });
  });

  it("closes mediasoup resources", async () => {
    const consumer = { close: vi.fn() };
    const producer = { close: vi.fn() };
    const transport = { close: vi.fn() };
    const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

    const session = new PeerSession("peer-1", "Alice", socket);
    session.consumers.set("c1", consumer as never);
    session.producers.set("p1", producer as never);
    session.transports.set("t1", transport as never);

    await session.closeMedia();

    expect(consumer.close).toHaveBeenCalledOnce();
    expect(producer.close).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(session.consumers.size).toBe(0);
  });

  it("does not send when socket is closed", () => {
    const socket = {
      readyState: WebSocket.CLOSED,
      send: vi.fn(),
    } as unknown as WebSocket;

    const session = new PeerSession("peer-1", "Alice", socket);
    session.send({ type: "test" });

    expect(socket.send).not.toHaveBeenCalled();
  });
});
