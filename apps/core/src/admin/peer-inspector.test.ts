import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { PeerSession } from "../domain/peer/peer-session.js";
import { RoomService } from "../domain/room/room-service.js";
import { AdminError } from "./types.js";
import {
  PeerInspector,
  createPeerInspector,
  inspectPeerSession,
  peerMediaObjectCount,
  summarizePeers,
} from "./peer-inspector.js";
import { createMockSocket } from "../test/helpers.js";

function mockSocket(): WebSocket {
  return { readyState: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket;
}

describe("peer-inspector", () => {
  it("collects peer inspection snapshot", () => {
    const roomService = new RoomService();
    roomService.joinRoom("room-a", "Alice", mockSocket());
    roomService.joinRoom("room-a", "Bob", mockSocket());

    const inspector = createPeerInspector(roomService);
    const snapshot = inspector.collect();

    expect(snapshot.totalPeers).toBe(2);
    expect(snapshot.peers).toHaveLength(2);
    expect(snapshot.peers[0]!.socketOpen).toBe(true);
  });

  it("inspects a single peer by id", () => {
    const roomService = new RoomService();
    const session = roomService.joinRoom("room-a", "Alice", mockSocket());
    const inspector = new PeerInspector(roomService);
    const peer = inspector.inspectPeer(session.peerId);
    expect(peer.peerId).toBe(session.peerId);
    expect(peer.displayName).toBe("Alice");
    expect(peer.roomId).toBe("room-a");
  });

  it("throws when peer is not found", () => {
    const inspector = new PeerInspector(new RoomService());
    expect(() => inspector.inspectPeer("missing")).toThrow(AdminError);
  });

  it("inspects peers in a specific room", () => {
    const roomService = new RoomService();
    roomService.joinRoom("room-a", "Alice", mockSocket());
    const inspector = new PeerInspector(roomService);
    expect(inspector.inspectPeersInRoom("room-a")).toHaveLength(1);
  });

  it("analyzes peer findings", () => {
    const roomService = new RoomService();
    roomService.joinRoom("room-a", "Alice", mockSocket());
    const inspector = new PeerInspector(roomService);
    const findings = inspector.analyze(inspector.collect());
    expect(findings.some((f) => f.code === "PEERS_CONNECTED")).toBe(true);
  });

  it("reports no peers when empty", () => {
    const inspector = new PeerInspector(new RoomService());
    const findings = inspector.analyze(inspector.collect());
    expect(findings.some((f) => f.code === "NO_PEERS")).toBe(true);
  });

  it("groups multiple peers in the same room", () => {
    const roomService = new RoomService();
    roomService.joinRoom("a", "Alice", mockSocket());
    roomService.joinRoom("a", "Bob", mockSocket());
    const groups = new PeerInspector(roomService).groupByRoom();
    expect(groups.get("a")).toHaveLength(2);
  });

  it("groups peers by room", () => {
    const roomService = new RoomService();
    roomService.joinRoom("a", "Alice", mockSocket());
    roomService.joinRoom("b", "Bob", mockSocket());
    const groups = new PeerInspector(roomService).groupByRoom();
    expect(groups.get("a")).toHaveLength(1);
    expect(groups.get("b")).toHaveLength(1);
  });

  it("inspects peer session directly", () => {
    const socket = createMockSocket();
    const session = new PeerSession("peer-1", "Test", socket);
    session.roomId = "room-1";
    const entry = inspectPeerSession(session);
    expect(entry.peerId).toBe("peer-1");
    expect(entry.hasActiveMedia).toBe(false);
    expect(entry.socketOpen).toBe(true);
  });

  it("counts media objects on peer entry", () => {
    const entry = {
      peerId: "p",
      displayName: "P",
      roomId: "r",
      socketOpen: true,
      transportCount: 2,
      producerCount: 1,
      consumerCount: 3,
      hasActiveMedia: true,
    };
    expect(peerMediaObjectCount(entry)).toBe(6);
  });

  it("summarizes peer snapshot", () => {
    expect(
      summarizePeers({
        collectedAtMs: 0,
        totalPeers: 3,
        peersWithMedia: 1,
        peersWithoutRoom: 0,
        peers: [],
      }),
    ).toBe("3 peers (1 with media)");
  });

  it("limits collected peers to maxPeers option", () => {
    const roomService = new RoomService();
    roomService.joinRoom("room-a", "Alice", mockSocket());
    roomService.joinRoom("room-a", "Bob", mockSocket());
    const inspector = new PeerInspector(roomService, { maxPeers: 1 });
    expect(inspector.collect().totalPeers).toBe(1);
  });

  it("handles missing sessions during collection", () => {
    const roomService = new RoomService();
    const session = roomService.joinRoom("room-a", "Alice", mockSocket());
    const getSession = roomService.getSession.bind(roomService);
    vi.spyOn(roomService, "getSession").mockImplementation((peerId) => {
      if (peerId === session.peerId) {
        throw new Error("missing");
      }
      return getSession(peerId);
    });

    const snapshot = new PeerInspector(roomService).collect();
    expect(snapshot.peers[0]!.socketOpen).toBe(false);
    expect(snapshot.peers[0]!.peerId).toBe(session.peerId);
  });

  it("handles missing sessions when inspecting peers in room", () => {
    const roomService = new RoomService();
    const session = roomService.joinRoom("room-a", "Alice", mockSocket());
    vi.spyOn(roomService, "getSession").mockImplementation(() => {
      throw new Error("missing");
    });

    const peers = new PeerInspector(roomService).inspectPeersInRoom("room-a");
    expect(peers[0]!.peerId).toBe(session.peerId);
    expect(peers[0]!.socketOpen).toBe(false);
  });

  it("analyzes closed sockets, high media, and orphaned peers", () => {
    const snapshot = {
      collectedAtMs: Date.now(),
      totalPeers: 3,
      peersWithMedia: 2,
      peersWithoutRoom: 1,
      peers: [
        {
          peerId: "p1",
          displayName: "P1",
          roomId: "r",
          socketOpen: false,
          transportCount: 0,
          producerCount: 0,
          consumerCount: 0,
          hasActiveMedia: false,
        },
        {
          peerId: "p2",
          displayName: "P2",
          roomId: "r",
          socketOpen: true,
          transportCount: 0,
          producerCount: 6,
          consumerCount: 5,
          hasActiveMedia: true,
        },
        {
          peerId: "p3",
          displayName: "P3",
          roomId: null,
          socketOpen: true,
          transportCount: 1,
          producerCount: 0,
          consumerCount: 0,
          hasActiveMedia: true,
        },
      ],
    };

    const findings = new PeerInspector(new RoomService()).analyze(snapshot);
    expect(findings.some((f) => f.code === "PEERS_SOCKET_CLOSED")).toBe(true);
    expect(findings.some((f) => f.code === "PEERS_HIGH_MEDIA")).toBe(true);
    expect(findings.some((f) => f.code === "PEERS_ORPHANED")).toBe(true);
  });

  it("counts peers with media and finds matching peers", () => {
    const roomService = new RoomService();
    const session = roomService.joinRoom("room-a", "Alice", mockSocket());
    session.transports.set("t1", {} as never);
    const inspector = new PeerInspector(roomService);

    expect(inspector.countPeersWithMedia()).toBe(1);
    expect(inspector.findPeers((peer) => peer.hasActiveMedia)).toHaveLength(1);
    expect(inspector.findPeers((peer) => peer.displayName === "missing")).toHaveLength(0);
  });

  it("groups unassigned peers separately", () => {
    const roomService = new RoomService();
    const session = roomService.joinRoom("room-a", "Alice", mockSocket());
    session.roomId = null;
    const groups = new PeerInspector(roomService).groupByRoom();
    expect(groups.get("unassigned")).toHaveLength(1);
  });

  it("detects active media on peer session", () => {
    const socket = createMockSocket();
    const session = new PeerSession("peer-1", "Test", socket);
    session.producers.set("prod", {} as never);
    const entry = inspectPeerSession(session);
    expect(entry.hasActiveMedia).toBe(true);
    expect(entry.producerCount).toBe(1);
  });
});
