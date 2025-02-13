import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import Fastify from "fastify";
import { createTestEnv } from "../../test/helpers.js";
import { RoomService } from "../../domain/room/room-service.js";
import type { SfuService } from "../../media/sfu-service.js";
import { registerSignalingWebSocket } from "./signaling.js";

describe("registerSignalingWebSocket", () => {
  let app: ReturnType<typeof Fastify>;
  let roomService: RoomService;
  let sfuService: SfuService;
  let port = 0;

  afterEach(async () => {
    await app.close();
  });

  async function startServer(): Promise<void> {
    roomService = new RoomService();
    sfuService = {
      getRouterRtpCapabilities: vi.fn().mockResolvedValue({ codecs: [] }),
      closeRoomMedia: vi.fn().mockResolvedValue(undefined),
    } as unknown as SfuService;

    app = Fastify({ logger: false });
    await registerSignalingWebSocket(app, createTestEnv(), roomService, sfuService);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    port = typeof address === "object" && address ? address.port : 0;
  }

  function openSocket(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });
  }

  it("returns an error for invalid JSON payloads", async () => {
    await startServer();
    const socket = await openSocket();

    const message = await new Promise<string>((resolve) => {
      socket.once("message", (data) => resolve(data.toString()));
      socket.send("not-json");
    });

    expect(JSON.parse(message).type).toBe("error");
    socket.close();
  });

  it("cleans up room media when the last peer disconnects", async () => {
    await startServer();
    const socket = await openSocket();

    socket.send(
      JSON.stringify({
        type: "room.join",
        payload: { roomId: "room-a", displayName: "Alice" },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(sfuService.closeRoomMedia).toHaveBeenCalledWith("room-a");
  });

  it("returns early when disconnect cleanup has no room membership", async () => {
    await startServer();
    const socket = await openSocket();

    socket.send(
      JSON.stringify({
        type: "room.join",
        payload: { roomId: "room-a", displayName: "Alice" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    vi.spyOn(roomService, "leaveBySocket").mockReturnValue(null);
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(sfuService.closeRoomMedia).not.toHaveBeenCalled();
  });
});
