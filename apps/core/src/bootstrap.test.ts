import { describe, expect, it, vi } from "vitest";
import { bootstrap, registerSignalHandlers } from "./bootstrap.js";
import { createTestEnv } from "./test/helpers.js";

vi.mock("./media/worker-pool.js", () => ({
  WorkerPool: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getNextWorker: vi.fn(),
  })),
}));

vi.mock("./server/app.js", () => ({
  createApp: vi.fn().mockResolvedValue({
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    log: { info: vi.fn() },
  }),
}));

vi.mock("./discovery/mdns.js", () => ({
  MdnsBroadcaster: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe("bootstrap", () => {
  it("starts workers, HTTP server, and mdns", async () => {
    const result = await bootstrap(createTestEnv({ httpPort: 0, mdnsEnabled: true }));
    expect(result.app.listen).toHaveBeenCalledOnce();
    expect(result.mdnsBroadcaster.start).toHaveBeenCalledOnce();
    await result.shutdown("TEST");
  });

  it("starts without mdns when disabled", async () => {
    const result = await bootstrap(createTestEnv({ httpPort: 0, mdnsEnabled: false }));
    expect(result.mdnsBroadcaster.start).toHaveBeenCalledOnce();
    await result.shutdown("TEST");
  });
});

describe("registerSignalHandlers", () => {
  it("invokes shutdown callback on SIGINT", async () => {
    const shutdownFn = vi.fn().mockResolvedValue(undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const listeners = new Map<string, () => void>();

    vi.spyOn(process, "on").mockImplementation(((event: string, handler: () => void) => {
      listeners.set(event, handler);
      return process;
    }) as never);

    registerSignalHandlers(shutdownFn);
    listeners.get("SIGINT")?.();

    await vi.waitFor(() => {
      expect(shutdownFn).toHaveBeenCalledWith("SIGINT");
    });

    exitSpy.mockRestore();
  });
});
