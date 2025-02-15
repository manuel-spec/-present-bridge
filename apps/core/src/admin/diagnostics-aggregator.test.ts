import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { RoomService } from "../domain/room/room-service.js";
import {
  DiagnosticsAggregator,
  countFindingsBySeverity,
  createDiagnosticsAggregator,
  hasCriticalFindings,
} from "./diagnostics-aggregator.js";
import { createWorkerProvider } from "./worker-diagnostics.js";

function mockSocket(): WebSocket {
  return { readyState: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket;
}

describe("diagnostics-aggregator", () => {
  it("collects aggregated diagnostics", async () => {
    const roomService = new RoomService();
    roomService.joinRoom("room-a", "Alice", mockSocket());

    const aggregator = createDiagnosticsAggregator({
      roomService,
      startTimeMs: Date.now() - 60_000,
    });

    const diagnostics = await aggregator.collect();
    expect(diagnostics.status).toBeTruthy();
    expect(diagnostics.server.uptimeSeconds).toBeGreaterThan(0);
    expect(diagnostics.rooms.totalRooms).toBe(1);
    expect(diagnostics.peers.totalPeers).toBe(1);
    expect(diagnostics.findings.length).toBeGreaterThan(0);
  });

  it("includes worker diagnostics when provider is configured", async () => {
    const provider = createWorkerProvider([
      {
        pid: 1234,
        getResourceUsage: vi.fn().mockResolvedValue({
          ruUtime: 1,
          ruStime: 1,
          ruMaxRss: 1024,
          ruIxrss: 0,
          ruIdrss: 0,
          ruIsrss: 0,
          ruMinflt: 0,
          ruMajflt: 0,
          ruNswap: 0,
          ruInblock: 0,
          ruOublock: 0,
          ruMsgsnd: 0,
          ruMsgrcv: 0,
          ruNsignals: 0,
          ruNvcsw: 0,
          ruNivcsw: 0,
        }),
      },
    ]);

    const aggregator = new DiagnosticsAggregator({
      roomService: new RoomService(),
      workerProvider: provider,
    });

    const diagnostics = await aggregator.collect();
    expect(diagnostics.workers.workerCount).toBe(1);
    expect(diagnostics.workers.aliveCount).toBe(1);
  });

  it("skips optional sections based on options", async () => {
    const aggregator = createDiagnosticsAggregator({ roomService: new RoomService() });
    const diagnostics = await aggregator.collect({
      includeWorkerStats: false,
      includeRoomDetails: false,
      includePeerDetails: false,
      includeNetworkInterfaces: false,
    });
    expect(diagnostics.workers.workerCount).toBe(0);
    expect(diagnostics.rooms.totalRooms).toBe(0);
    expect(diagnostics.peers.totalPeers).toBe(0);
  });

  it("collects individual subsystems", async () => {
    const roomService = new RoomService();
    roomService.createRoom("r1");
    const aggregator = new DiagnosticsAggregator({ roomService });

    expect(aggregator.collectServer().hostname).toBeTruthy();
    expect(aggregator.collectRooms().totalRooms).toBe(1);
    expect(aggregator.collectPeers().totalPeers).toBe(0);
    await expect(aggregator.collectWorkers()).resolves.toBeTruthy();
  });

  it("returns health status and summary", async () => {
    const aggregator = createDiagnosticsAggregator({ roomService: new RoomService() });
    const status = await aggregator.getHealthStatus();
    expect(["healthy", "degraded", "unhealthy"]).toContain(status);
    const summary = await aggregator.summarize();
    expect(summary).toContain("status=");
    expect(summary).toContain("uptime=");
  });

  it("filters findings by component and severity", async () => {
    const aggregator = createDiagnosticsAggregator({ roomService: new RoomService() });
    const findings = await aggregator.analyze();
    const serverFindings = aggregator.filterFindingsByComponent(findings, "process");
    expect(serverFindings.every((f) => f.component === "process")).toBe(true);

    const warnings = aggregator.filterFindingsByMinSeverity(findings, "warning");
    expect(warnings.every((f) => f.severity !== "info")).toBe(true);
  });

  it("detects critical findings", () => {
    expect(hasCriticalFindings([{ code: "C", severity: "critical", message: "x", component: "y" }])).toBe(
      true,
    );
    expect(hasCriticalFindings([{ code: "I", severity: "info", message: "x", component: "y" }])).toBe(
      false,
    );
  });

  it("counts findings by severity", () => {
    const counts = countFindingsBySeverity([
      { code: "A", severity: "info", message: "a", component: "x" },
      { code: "B", severity: "warning", message: "b", component: "x" },
      { code: "C", severity: "warning", message: "c", component: "x" },
    ]);
    expect(counts.info).toBe(1);
    expect(counts.warning).toBe(2);
    expect(counts.error).toBe(0);
  });
});
