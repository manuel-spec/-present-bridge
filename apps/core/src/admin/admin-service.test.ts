import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { RoomService } from "../domain/room/room-service.js";
import { createWorkerProvider } from "./worker-diagnostics.js";
import { AdminService, createAdminService } from "./admin-service.js";

function mockSocket(): WebSocket {
  return { readyState: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket;
}

describe("admin-service", () => {
  it("collects full diagnostics", async () => {
    const roomService = new RoomService();
    roomService.joinRoom("room-a", "Alice", mockSocket());

    const service = createAdminService({ roomService });
    const diagnostics = await service.getDiagnostics();

    expect(diagnostics.rooms.totalRooms).toBe(1);
    expect(diagnostics.peers.totalPeers).toBe(1);
    expect(service.getLastDiagnostics()).toBe(diagnostics);
  });

  it("returns admin status response", async () => {
    const service = new AdminService({
      roomService: new RoomService(),
      startTimeMs: Date.now() - 30_000,
    });
    const status = await service.getStatus();
    expect(status.uptimeSeconds).toBeGreaterThan(0);
    expect(status.memory.heapUsed).toBeTruthy();
    expect(["healthy", "degraded", "unhealthy"]).toContain(status.status);
  });

  it("returns health status and findings", async () => {
    const service = createAdminService({ roomService: new RoomService() });
    const health = await service.getHealthStatus();
    const findings = await service.getFindings();
    expect(health).toBeTruthy();
    expect(Array.isArray(findings)).toBe(true);
  });

  it("inspects individual rooms and peers", async () => {
    const roomService = new RoomService();
    const session = roomService.joinRoom("room-a", "Alice", mockSocket());
    const service = new AdminService({ roomService });

    const room = service.inspectRoom("room-a");
    expect(room.peerCount).toBe(1);

    const peer = service.inspectPeer(session.peerId);
    expect(peer.displayName).toBe("Alice");
  });

  it("lists room ids", () => {
    const roomService = new RoomService();
    roomService.createRoom("x");
    roomService.createRoom("y");
    const service = new AdminService({ roomService });
    expect(service.listRoomIds()).toEqual(["x", "y"]);
  });

  it("returns subsystem snapshots", async () => {
    const provider = createWorkerProvider([
      {
        pid: 99,
        getResourceUsage: vi.fn().mockResolvedValue({
          ruUtime: 0,
          ruStime: 0,
          ruMaxRss: 0,
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

    const service = new AdminService({
      roomService: new RoomService(),
      workerProvider: provider,
    });

    expect(service.getServerDiagnostics().pid).toBe(process.pid);
    expect((await service.getWorkerDiagnostics()).workerCount).toBe(1);
    expect(service.getRoomInspection().totalRooms).toBe(0);
    expect(service.getPeerInspection().totalPeers).toBe(0);
  });

  it("checks health and summarizes", async () => {
    const service = createAdminService({ roomService: new RoomService() });
    const healthy = await service.isHealthy();
    expect(typeof healthy).toBe("boolean");
    const summary = await service.summarize();
    expect(summary).toContain("rooms=");
  });

  it("exposes default options and start time", () => {
    const start = Date.now();
    const service = new AdminService({ roomService: new RoomService(), startTimeMs: start });
    expect(service.getStartTimeMs()).toBe(start);
    expect(service.getDefaultOptions().maxRooms).toBe(100);
  });
});
