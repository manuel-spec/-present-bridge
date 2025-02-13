import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { RoomService } from "../../domain/room/room-service.js";
import { registerRoomRoutes } from "./rooms.js";

describe("registerRoomRoutes", () => {
  let app: ReturnType<typeof Fastify>;
  let roomService: RoomService;

  beforeEach(async () => {
    roomService = new RoomService();
    app = Fastify({ logger: false });
    registerRoomRoutes(app, roomService);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 400 for duplicate room creation", async () => {
    roomService.createRoom("room-a");

    const response = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: { roomId: "room-a" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INTERNAL_ERROR");
  });

  it("rethrows unexpected create errors", async () => {
    vi.spyOn(roomService, "createRoom").mockImplementation(() => {
      throw new Error("unexpected");
    });

    const response = await app.inject({
      method: "POST",
      url: "/rooms",
      payload: {},
    });

    expect(response.statusCode).toBe(500);
  });

  it("rethrows unexpected get errors", async () => {
    vi.spyOn(roomService, "getRoom").mockImplementation(() => {
      throw new Error("unexpected");
    });

    const response = await app.inject({
      method: "GET",
      url: "/rooms/room-a",
    });

    expect(response.statusCode).toBe(500);
  });
});
