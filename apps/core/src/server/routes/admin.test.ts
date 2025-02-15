import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { WebSocket } from "ws";
import { createAdminService } from "../../admin/admin-service.js";
import { RoomService } from "../../domain/room/room-service.js";
import { createMetricsService } from "../../metrics/metrics-service.js";
import { registerAdminRoutes } from "./admin.js";

function mockSocket(): WebSocket {
  return { readyState: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket;
}

describe("registerAdminRoutes", () => {
  let app: ReturnType<typeof Fastify>;
  let roomService: RoomService;

  beforeEach(async () => {
    roomService = new RoomService();
    const adminService = createAdminService({ roomService });
    Object.assign(adminService, {
      listRooms: () => adminService.getRoomInspection().rooms,
    });
    const metricsService = createMetricsService({ roomService, version: "0.1.0" });

    app = Fastify({ logger: false });
    registerAdminRoutes(app, {
      adminService,
      metricsService,
      version: "0.1.0",
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns admin status", async () => {
    const response = await app.inject({ method: "GET", url: "/admin/status" });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBeTruthy();
  });

  it("returns admin diagnostics", async () => {
    const response = await app.inject({ method: "GET", url: "/admin/diagnostics" });
    expect(response.statusCode).toBe(200);
    expect(response.json().rooms).toBeTruthy();
    expect(response.json().peers).toBeTruthy();
  });

  it("lists admin rooms", async () => {
    roomService.joinRoom("room-a", "Alice", mockSocket());
    const response = await app.inject({ method: "GET", url: "/admin/rooms" });
    expect(response.statusCode).toBe(200);
    expect(response.json().rooms).toHaveLength(1);
  });

  it("inspects a single admin room", async () => {
    roomService.joinRoom("room-a", "Alice", mockSocket());
    const response = await app.inject({ method: "GET", url: "/admin/rooms/room-a" });
    expect(response.statusCode).toBe(200);
    expect(response.json().roomId).toBe("room-a");
    expect(response.json().peerCount).toBe(1);
  });

  it("scrapes prometheus metrics", async () => {
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("packet_bridge_up");
  });
});
