import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../../lib/errors.js";
import { RoomService } from "./room-service.js";

function mockSocket(): WebSocket {
  return { readyState: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket;
}

describe("RoomService", () => {
  it("creates and retrieves a room", () => {
    const service = new RoomService();
    const created = service.createRoom("room-1");

    expect(created.roomId).toBe("room-1");
    expect(created.peerCount).toBe(0);

    const fetched = service.getRoom("room-1");
    expect(fetched.peerCount).toBe(0);
  });

  it("throws when room is missing", () => {
    const service = new RoomService();

    expect(() => service.getRoom("missing")).toThrow(AppError);
    try {
      service.getRoom("missing");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ROOM_NOT_FOUND);
    }
  });

  it("joins a peer and tracks room membership", () => {
    const service = new RoomService();
    const session = service.joinRoom("room-a", "Alice", mockSocket());

    expect(session.peerId).toBeTruthy();
    expect(service.getPeersInRoom("room-a")).toHaveLength(1);
  });

  it("removes empty rooms when last peer leaves", () => {
    const service = new RoomService();
    const socket = mockSocket();
    const session = service.joinRoom("room-a", "Alice", socket);

    service.leavePeer(session.peerId);

    expect(() => service.getRoom("room-a")).toThrow(AppError);
  });

  it("lists active rooms", () => {
    const service = new RoomService();
    service.createRoom("room-a");
    service.createRoom("room-b");

    expect(service.listRooms()).toHaveLength(2);
  });
});
