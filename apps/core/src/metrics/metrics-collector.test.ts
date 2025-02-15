import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { RoomService } from "../domain/room/room-service.js";
import { MetricRegistry } from "./registry.js";
import { MetricsCollector, createMetricsCollector } from "./metrics-collector.js";

function mockSocket(): WebSocket {
  return { readyState: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket;
}

describe("MetricsCollector", () => {
  it("initializes and registers standard metrics", () => {
    const roomService = new RoomService();
    const registry = new MetricRegistry();
    const collector = createMetricsCollector({ roomService, registry, version: "1.0.0" });

    collector.initialize();
    expect(registry.has("packet_bridge_process_uptime_seconds")).toBe(true);
    expect(registry.has("packet_bridge_peers_connected_total")).toBe(true);
    expect(registry.getCounter("packet_bridge_peers_joined_total")?.name).toBe(
      "packet_bridge_peers_joined_total",
    );
  });

  it("collects system metrics", () => {
    const collector = new MetricsCollector({
      roomService: new RoomService(),
      registry: new MetricRegistry(),
      startTimeMs: Date.now() - 5000,
    });

    const snapshot = collector.collect();
    expect(snapshot.system.uptimeSeconds).toBeGreaterThan(0);
    expect(snapshot.system.memoryRssBytes).toBeGreaterThan(0);
    expect(snapshot.system.cpuCount).toBeGreaterThan(0);
    expect(snapshot.system.nodeVersion).toMatch(/^v/);
  });

  it("counts peers with active media objects", () => {
    const roomService = new RoomService();
    const session = roomService.joinRoom("room-a", "Alice", mockSocket());
    session.producers.set("p1", {} as never);

    const collector = new MetricsCollector({
      roomService,
      registry: new MetricRegistry(),
    });
    collector.initialize();
    const snapshot = collector.collect();
    expect(snapshot.peers.peersWithMedia).toBe(1);
    expect(snapshot.peers.totalTransports).toBe(0);
    expect(snapshot.peers.totalProducers).toBe(1);
  });

  it("collects room and peer metrics", () => {
    const roomService = new RoomService();
    roomService.joinRoom("room-a", "Alice", mockSocket());
    roomService.joinRoom("room-a", "Bob", mockSocket());
    roomService.joinRoom("room-b", "Carol", mockSocket());

    const registry = new MetricRegistry();
    const collector = new MetricsCollector({ roomService, registry });
    const snapshot = collector.collect();

    expect(snapshot.rooms.activeRoomCount).toBe(2);
    expect(snapshot.rooms.totalPeerCount).toBe(3);
    expect(snapshot.peers.connectedPeerCount).toBe(3);
    expect(snapshot.rooms.largestRoomPeerCount).toBe(2);
  });

  it("records peer join and leave events", () => {
    const registry = new MetricRegistry();
    const collector = new MetricsCollector({
      roomService: new RoomService(),
      registry,
    });
    collector.initialize();
    collector.recordPeerJoined();
    collector.recordPeerJoined();
    collector.recordPeerLeft();
    collector.collect();

    const counter = registry.getCounter("packet_bridge_peers_joined_total");
    expect(counter?.get()).toBe(2);
    expect(registry.getCounter("packet_bridge_peers_left_total")?.get()).toBe(1);
  });

  it("records HTTP request durations", () => {
    const registry = new MetricRegistry();
    const collector = new MetricsCollector({
      roomService: new RoomService(),
      registry,
    });
    collector.initialize();
    collector.recordRequestDuration("GET", "/health", 200, 0.05);
    collector.collect();

    const histogram = registry.getHistogram("packet_bridge_http_request_duration_seconds");
    expect(histogram?.getCount({ method: "GET", route: "/health", status: "200" })).toBe(1);
  });

  it("is idempotent on initialize", () => {
    const registry = new MetricRegistry();
    const collector = new MetricsCollector({
      roomService: new RoomService(),
      registry,
    });
    collector.initialize();
    collector.initialize();
    expect(registry.size()).toBeGreaterThan(0);
  });

  it("ignores peers that disappear during collection", () => {
    const roomService = new RoomService();
    const session = roomService.joinRoom("room-a", "Alice", mockSocket());
    session.transports.set("t1", {} as never);
    const getSession = roomService.getSession.bind(roomService);
    vi.spyOn(roomService, "getSession").mockImplementation((peerId) => {
      if (peerId === session.peerId) {
        throw new Error("gone");
      }
      return getSession(peerId);
    });

    const collector = new MetricsCollector({
      roomService,
      registry: new MetricRegistry(),
    });
    collector.initialize();
    const snapshot = collector.collect();
    expect(snapshot.peers.connectedPeerCount).toBe(1);
    expect(snapshot.peers.peersWithMedia).toBe(0);
  });

  it("exposes version and start time", () => {
    const start = Date.now() - 1000;
    const collector = new MetricsCollector({
      roomService: new RoomService(),
      registry: new MetricRegistry(),
      version: "2.0.0",
      startTimeMs: start,
    });
    expect(collector.getVersion()).toBe("2.0.0");
    expect(collector.getStartTimeMs()).toBe(start);
  });
});
