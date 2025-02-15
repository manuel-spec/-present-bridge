import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { RoomService } from "../domain/room/room-service.js";
import {
  RoomInspector,
  createRoomInspector,
  roomHasMediaActivity,
  summarizeRooms,
} from "./room-inspector.js";

function mockSocket(): WebSocket {
  return { readyState: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket;
}

describe("room-inspector", () => {
  it("collects room inspection snapshot", () => {
    const roomService = new RoomService();
    roomService.joinRoom("room-a", "Alice", mockSocket());
    roomService.joinRoom("room-a", "Bob", mockSocket());

    const inspector = createRoomInspector(roomService);
    const snapshot = inspector.collect();

    expect(snapshot.totalRooms).toBe(1);
    expect(snapshot.totalPeers).toBe(2);
    expect(snapshot.rooms[0]!.roomId).toBe("room-a");
    expect(snapshot.rooms[0]!.peerCount).toBe(2);
  });

  it("inspects a single room by id", () => {
    const roomService = new RoomService();
    roomService.createRoom("room-x");
    const inspector = new RoomInspector(roomService);
    const room = inspector.inspectRoomById("room-x");
    expect(room.roomId).toBe("room-x");
    expect(room.peerCount).toBe(0);
    expect(room.ageSeconds).toBeGreaterThanOrEqual(0);
  });

  it("lists room ids", () => {
    const roomService = new RoomService();
    roomService.createRoom("a");
    roomService.createRoom("b");
    const inspector = new RoomInspector(roomService);
    expect(inspector.listRoomIds()).toEqual(["a", "b"]);
  });

  it("analyzes empty rooms", () => {
    const inspector = new RoomInspector(new RoomService());
    const findings = inspector.analyze(inspector.collect());
    expect(findings.some((f) => f.code === "NO_ACTIVE_ROOMS")).toBe(true);
  });

  it("warns about large rooms", () => {
    const roomService = new RoomService();
    for (let index = 0; index < 21; index += 1) {
      roomService.joinRoom("big", `Peer${index}`, mockSocket());
    }
    const inspector = new RoomInspector(roomService);
    const findings = inspector.analyze(inspector.collect());
    expect(findings.some((f) => f.code === "LARGE_ROOMS")).toBe(true);
  });

  it("finds the largest room", () => {
    const roomService = new RoomService();
    roomService.joinRoom("small", "A", mockSocket());
    roomService.joinRoom("big", "B", mockSocket());
    roomService.joinRoom("big", "C", mockSocket());

    const inspector = new RoomInspector(roomService);
    const largest = inspector.largestRoom();
    expect(largest?.roomId).toBe("big");
    expect(largest?.peerCount).toBe(2);
  });

  it("computes average peers per room", () => {
    const roomService = new RoomService();
    roomService.joinRoom("a", "A", mockSocket());
    roomService.joinRoom("b", "B", mockSocket());
    roomService.joinRoom("b", "C", mockSocket());

    const inspector = new RoomInspector(roomService);
    expect(inspector.averagePeersPerRoom()).toBe(1.5);
  });

  it("summarizes room snapshot", () => {
    const snapshot = {
      collectedAtMs: Date.now(),
      totalRooms: 2,
      totalPeers: 5,
      rooms: [],
    };
    expect(summarizeRooms(snapshot)).toBe("2 rooms, 5 peers");
  });

  it("detects media activity in rooms", () => {
    const room = {
      roomId: "r",
      peerCount: 1,
      createdAt: new Date().toISOString(),
      ageSeconds: 0,
      peers: [
        {
          peerId: "p",
          displayName: "P",
          roomId: "r",
          socketOpen: true,
          transportCount: 1,
          producerCount: 0,
          consumerCount: 0,
          hasActiveMedia: true,
        },
      ],
    };
    expect(roomHasMediaActivity(room)).toBe(true);
    expect(
      roomHasMediaActivity({
        ...room,
        peers: [{ ...room.peers[0]!, hasActiveMedia: false, transportCount: 0 }],
      }),
    ).toBe(false);
  });

  it("returns peer count for a room", () => {
    const roomService = new RoomService();
    roomService.joinRoom("room-a", "Alice", mockSocket());
    roomService.joinRoom("room-a", "Bob", mockSocket());
    expect(new RoomInspector(roomService).getPeerCount("room-a")).toBe(2);
  });

  it("finds rooms matching a predicate", () => {
    const roomService = new RoomService();
    roomService.joinRoom("busy", "Alice", mockSocket());
    roomService.createRoom("empty");
    const inspector = new RoomInspector(roomService);
    const busyRooms = inspector.findRooms((room) => room.peerCount > 0);
    expect(busyRooms).toHaveLength(1);
    expect(busyRooms[0]!.roomId).toBe("busy");
  });

  it("warns about empty and stale rooms", () => {
    const inspector = new RoomInspector(new RoomService());
    const findings = inspector.analyze({
      collectedAtMs: Date.now(),
      totalRooms: 2,
      totalPeers: 0,
      rooms: [
        {
          roomId: "empty",
          peerCount: 0,
          createdAt: new Date().toISOString(),
          ageSeconds: 0,
          peers: [],
        },
        {
          roomId: "stale",
          peerCount: 1,
          createdAt: new Date(Date.now() - 90_000_000).toISOString(),
          ageSeconds: 90_000,
          peers: [],
        },
      ],
    });
    expect(findings.some((f) => f.code === "EMPTY_ROOMS")).toBe(true);
    expect(findings.some((f) => f.code === "STALE_ROOMS")).toBe(true);
  });

  it("reports truncated room inspection", () => {
    const inspector = new RoomInspector(new RoomService(), { maxRooms: 1 });
    const findings = inspector.analyze({
      collectedAtMs: Date.now(),
      totalRooms: 3,
      totalPeers: 0,
      rooms: [
        {
          roomId: "a",
          peerCount: 0,
          createdAt: new Date().toISOString(),
          ageSeconds: 0,
          peers: [],
        },
      ],
    });
    expect(findings.some((f) => f.code === "ROOMS_TRUNCATED")).toBe(true);
  });

  it("omits peer details when disabled", () => {
    const roomService = new RoomService();
    roomService.joinRoom("room-a", "Alice", mockSocket());
    const inspector = new RoomInspector(roomService, { includePeerDetails: false });
    expect(inspector.collect().rooms[0]!.peers).toEqual([]);
  });

  it("handles missing sessions when building room details", () => {
    const roomService = new RoomService();
    const session = roomService.joinRoom("room-a", "Alice", mockSocket());
    vi.spyOn(roomService, "getSession").mockImplementation(() => {
      throw new Error("missing");
    });

    const room = new RoomInspector(roomService).inspectRoomById("room-a");
    expect(room.peers[0]!.peerId).toBe(session.peerId);
    expect(room.peers[0]!.socketOpen).toBe(false);
  });

  it("returns null largest room when no rooms exist", () => {
    expect(new RoomInspector(new RoomService()).largestRoom()).toBeNull();
    expect(new RoomInspector(new RoomService()).averagePeersPerRoom()).toBe(0);
  });
});
