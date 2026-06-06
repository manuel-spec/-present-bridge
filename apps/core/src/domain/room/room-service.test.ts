import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { ErrorCode } from "@bridge-packet/shared";
import { AppError } from "../../lib/errors.js";
import { RoomService } from "./room-service.js";

function mockSocket(): WebSocket {
  return { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
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

  it("broadcasts to peers excluding sender", () => {
    const service = new RoomService();
    const aliceSocket = mockSocket();
    const bobSocket = mockSocket();
    const alice = service.joinRoom("room-a", "Alice", aliceSocket);
    service.joinRoom("room-a", "Bob", bobSocket);

    service.broadcast("room-a", { type: "ping" }, alice.peerId);

    expect(bobSocket.send).toHaveBeenCalledOnce();
    expect(aliceSocket.send).not.toHaveBeenCalled();
  });

  it("returns null when leaving unknown peer", () => {
    const service = new RoomService();
    expect(service.leavePeer("missing")).toBeNull();
  });

  it("returns null when leaving by unknown socket", () => {
    const service = new RoomService();
    expect(service.leaveBySocket(mockSocket())).toBeNull();
  });

  it("throws when fetching missing session", () => {
    const service = new RoomService();
    expect(() => service.getSession("missing")).toThrow(AppError);
    expect(() => service.getSessionBySocket(mockSocket())).toThrow(AppError);
  });

  it("returns empty peers for missing room", () => {
    const service = new RoomService();
    expect(service.getPeersInRoom("missing")).toEqual([]);
  });

  it("no-ops broadcast for missing room", () => {
    const service = new RoomService();
    expect(() => service.broadcast("missing", { type: "ping" })).not.toThrow();
  });

  it("rethrows unexpected store errors", () => {
    const service = new RoomService();
    vi.spyOn(service["store"], "create").mockImplementation(() => {
      throw new Error("disk failure");
    });

    expect(() => service.createRoom()).toThrow("disk failure");
  });

  it("closes all sessions and rooms", async () => {
    const service = new RoomService();
    const session = service.joinRoom("room-a", "Alice", mockSocket());
    const closeSpy = vi.spyOn(session, "closeMedia");

    service.closeAll();

    expect(closeSpy).toHaveBeenCalledOnce();
    expect(service.listRooms()).toHaveLength(0);
  });
});
