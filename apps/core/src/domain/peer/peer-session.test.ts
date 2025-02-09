import { describe, expect, it } from "vitest";
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
});
