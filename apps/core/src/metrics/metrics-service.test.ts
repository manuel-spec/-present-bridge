import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { RoomService } from "../domain/room/room-service.js";
import { Counter } from "./counter.js";
import { Gauge } from "./gauge.js";
import { Histogram } from "./histogram.js";
import { MetricRegistry } from "./registry.js";
import { MetricsError } from "./types.js";
import {
  MetricsService,
  assertMetricAvailable,
  createDefaultMetricsService,
  createMetricsService,
} from "./metrics-service.js";

function mockSocket(): WebSocket {
  return { readyState: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket;
}

describe("MetricsService", () => {
  it("initializes and scrapes prometheus output", () => {
    const service = createMetricsService({
      roomService: new RoomService(),
      version: "0.1.0",
    });

    const response = service.scrape();
    expect(response.contentType).toContain("text/plain");
    expect(response.body).toContain("packet_bridge_up");
    expect(response.metricCount).toBeGreaterThan(0);
  });

  it("records peer lifecycle events", () => {
    const service = new MetricsService({ roomService: new RoomService() });
    service.onPeerJoined();
    service.onPeerLeft();
    const snapshot = service.collect();
    expect(snapshot.samples.length).toBeGreaterThan(0);
  });

  it("records HTTP request timings", () => {
    const service = new MetricsService({ roomService: new RoomService() });
    service.onHttpRequest("GET", "/health", 200, 50);
    service.collect();
    expect(service.getStatus().registrySize).toBeGreaterThan(0);
  });

  it("returns service status", () => {
    const service = createMetricsService({
      roomService: new RoomService(),
      version: "1.2.3",
      startTimeMs: Date.now() - 10_000,
    });
    const status = service.getStatus();
    expect(status.initialized).toBe(true);
    expect(status.version).toBe("1.2.3");
    expect(status.uptimeSeconds).toBeGreaterThan(0);
  });

  it("collects application metrics snapshot", () => {
    const roomService = new RoomService();
    roomService.joinRoom("r1", "Alice", mockSocket());
    const service = new MetricsService({ roomService });
    const appMetrics = service.collectApplicationMetrics();
    expect(appMetrics.rooms.activeRoomCount).toBe(1);
    expect(appMetrics.peers.connectedPeerCount).toBe(1);
  });

  it("scrapes health endpoint output", () => {
    const service = new MetricsService({ roomService: new RoomService() });
    const health = service.scrapeHealth(true);
    expect(health.body).toContain("packet_bridge_up 1");
  });

  it("resets and restarts metrics", () => {
    const registry = new MetricRegistry();
    const service = new MetricsService({ roomService: new RoomService(), registry });
    service.onPeerJoined();
    service.reset();
    service.restart();
    expect(service.getStatus().initialized).toBe(true);
  });

  it("registers custom metrics", () => {
    const service = new MetricsService({ roomService: new RoomService() });
    const counter = new Counter("custom_total", { help: "custom" });
    const gauge = new Gauge("custom_gauge", { help: "custom" });
    const histogram = new Histogram("custom_hist", { help: "custom", buckets: [1] });
    service.registerCounter(counter);
    service.registerGauge(gauge);
    service.registerHistogram(histogram);
    expect(service.getRegistry().has("custom_total")).toBe(true);
    expect(service.getCollector()).toBeTruthy();
    expect(service.collect().metricCount).toBeGreaterThan(0);
  });

  it("uses default registry via createDefaultMetricsService", () => {
    const service = createDefaultMetricsService(new RoomService(), "0.0.1");
    expect(service.getRegistry()).toBeTruthy();
  });

  it("asserts metric availability", () => {
    const registry = new MetricRegistry();
    registry.registerGauge(new Gauge("taken", { help: "taken" }));
    expect(() => assertMetricAvailable(registry, "taken")).toThrow(MetricsError);
    expect(() => assertMetricAvailable(registry, "free")).not.toThrow();
  });
});
