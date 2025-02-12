import { describe, expect, it, vi } from "vitest";
import { shutdown } from "./shutdown.js";

describe("shutdown", () => {
  it("closes room sessions, mdns, workers, and the HTTP server", async () => {
    const roomService = { closeAll: vi.fn() };
    const mdnsBroadcaster = { stop: vi.fn().mockResolvedValue(undefined) };
    const workerPool = { close: vi.fn().mockResolvedValue(undefined) };
    const app = { close: vi.fn().mockResolvedValue(undefined) };

    await shutdown({
      app: app as never,
      workerPool: workerPool as never,
      mdnsBroadcaster: mdnsBroadcaster as never,
      roomService: roomService as never,
    });

    expect(roomService.closeAll).toHaveBeenCalledOnce();
    expect(mdnsBroadcaster.stop).toHaveBeenCalledOnce();
    expect(workerPool.close).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
  });

  it("skips mdns stop when broadcaster is null", async () => {
    const roomService = { closeAll: vi.fn() };
    const workerPool = { close: vi.fn().mockResolvedValue(undefined) };
    const app = { close: vi.fn().mockResolvedValue(undefined) };

    await shutdown({
      app: app as never,
      workerPool: workerPool as never,
      mdnsBroadcaster: null,
      roomService: roomService as never,
    });

    expect(app.close).toHaveBeenCalledOnce();
  });
});
