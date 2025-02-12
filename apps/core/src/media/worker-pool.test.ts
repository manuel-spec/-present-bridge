import { beforeEach, describe, expect, it, vi } from "vitest";
import * as mediasoup from "mediasoup";
import { createTestEnv, createMockWorker } from "../test/helpers.js";
import { WorkerPool } from "./worker-pool.js";

vi.mock("mediasoup", () => ({
  createWorker: vi.fn(),
}));

describe("WorkerPool", () => {
  beforeEach(() => {
    vi.mocked(mediasoup.createWorker).mockReset();
  });

  it("starts configured number of workers", async () => {
    const mockWorker = createMockWorker();
    vi.mocked(mediasoup.createWorker).mockResolvedValue(mockWorker as never);

    const pool = new WorkerPool(createTestEnv({ mediasoupWorkerCount: 2 }));
    await pool.start();

    expect(mediasoup.createWorker).toHaveBeenCalledTimes(2);
    expect(mockWorker.on).toHaveBeenCalledWith("died", expect.any(Function));
  });

  it("round-robins workers", async () => {
    const workerA = createMockWorker();
    const workerB = { ...createMockWorker(), pid: 22222 };
    vi.mocked(mediasoup.createWorker)
      .mockResolvedValueOnce(workerA as never)
      .mockResolvedValueOnce(workerB as never);

    const pool = new WorkerPool(createTestEnv({ mediasoupWorkerCount: 2 }));
    await pool.start();

    expect(pool.getNextWorker()).toBe(workerA);
    expect(pool.getNextWorker()).toBe(workerB);
    expect(pool.getNextWorker()).toBe(workerA);
  });

  it("throws when no workers are available", () => {
    const pool = new WorkerPool(createTestEnv());
    expect(() => pool.getNextWorker()).toThrow("No mediasoup workers available");
  });

  it("closes all workers", async () => {
    const mockWorker = createMockWorker();
    vi.mocked(mediasoup.createWorker).mockResolvedValue(mockWorker as never);

    const pool = new WorkerPool(createTestEnv());
    await pool.start();
    await pool.close();

    expect(mockWorker.close).toHaveBeenCalledOnce();
  });

  it("triggers process exit when worker dies", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    let diedHandler: (() => void) | undefined;

    vi.mocked(mediasoup.createWorker).mockImplementation(async () => {
      const worker = createMockWorker();
      worker.on.mockImplementation((event: string, handler: () => void) => {
        if (event === "died") {
          diedHandler = handler;
        }
      });
      return worker as never;
    });

    const pool = new WorkerPool(createTestEnv());
    await pool.start();
    diedHandler?.();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
