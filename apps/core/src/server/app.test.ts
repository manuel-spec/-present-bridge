import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../test/helpers.js";
import { RoomService } from "../domain/room/room-service.js";
import type { SfuService } from "../media/sfu-service.js";
import { createApp } from "./app.js";

describe("createApp HTTP routes", () => {
  let roomService: RoomService;
  let sfuService: SfuService;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    roomService = new RoomService();
    sfuService = {
      closeRoomMedia: vi.fn().mockResolvedValue(undefined),
    } as unknown as SfuService;

    app = await createApp(createTestEnv(), { roomService, sfuService });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns health status", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });

  it("returns server info for manual discovery", async () => {
    const response = await app.inject({ method: "GET", url: "/info" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      announcedIp: "127.0.0.1",
      wsPath: "/ws",
      mdnsEnabled: false,
    });
  });

  it("creates, lists, and fetches rooms", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: { roomId: "room-a" },
    });
    expect(createResponse.statusCode).toBe(201);

    const listResponse = await app.inject({ method: "GET", url: "/rooms" });
    expect(listResponse.json().rooms).toHaveLength(1);

    const getResponse = await app.inject({ method: "GET", url: "/rooms/room-a" });
    expect(getResponse.statusCode).toBe(200);
  });

  it("returns 404 for missing room", async () => {
    const response = await app.inject({ method: "GET", url: "/rooms/missing" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("ROOM_NOT_FOUND");
  });

  it("returns 404 for unknown routes", async () => {
    const response = await app.inject({ method: "GET", url: "/missing" });
    expect(response.statusCode).toBe(404);
  });

  it("runs with production log level when dev mode is disabled", async () => {
    await app.close();
    app = await createApp(createTestEnv({ devMode: false }), { roomService, sfuService });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });
});
