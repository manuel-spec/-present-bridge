import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRouter, createMockWorker } from "../test/helpers.js";
import { WorkerPool } from "./worker-pool.js";
import { RouterManager } from "./router-manager.js";

describe("RouterManager", () => {
  let workerPool: WorkerPool;
  let mockWorker: ReturnType<typeof createMockWorker>;

  beforeEach(async () => {
    mockWorker = createMockWorker();
    workerPool = {
      getNextWorker: vi.fn().mockReturnValue(mockWorker),
    } as unknown as WorkerPool;
  });

  it("creates and caches routers per room", async () => {
    const manager = new RouterManager(workerPool);
    const first = await manager.getOrCreateRouter("room-a");
    const second = await manager.getOrCreateRouter("room-a");

    expect(first).toBe(second);
    expect(mockWorker.createRouter).toHaveBeenCalledOnce();
  });

  it("returns undefined for unknown router", () => {
    const manager = new RouterManager(workerPool);
    expect(manager.getRouter("missing")).toBeUndefined();
  });

  it("closes and removes a router", async () => {
    const router = createMockRouter();
    mockWorker.createRouter.mockResolvedValue(router);

    const manager = new RouterManager(workerPool);
    await manager.getOrCreateRouter("room-a");
    await manager.closeRouter("room-a");

    expect(router.close).toHaveBeenCalledOnce();
    expect(manager.getRouter("room-a")).toBeUndefined();
  });

  it("closes all routers", async () => {
    const routerA = createMockRouter("room-a");
    const routerB = createMockRouter("room-b");
    mockWorker.createRouter
      .mockResolvedValueOnce(routerA)
      .mockResolvedValueOnce(routerB);

    const manager = new RouterManager(workerPool);
    await manager.getOrCreateRouter("room-a");
    await manager.getOrCreateRouter("room-b");
    await manager.closeAll();

    expect(routerA.close).toHaveBeenCalledOnce();
    expect(routerB.close).toHaveBeenCalledOnce();
  });
});
