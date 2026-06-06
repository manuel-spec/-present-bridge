import { describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../test/helpers.js";
import { MdnsBroadcaster } from "./mdns.js";

const publish = vi.fn();
const stop = vi.fn((callback: () => void) => callback());
const destroy = vi.fn();

vi.mock("bonjour-service", () => ({
  default: vi.fn().mockImplementation(() => ({
    publish,
    destroy,
  })),
}));

describe("MdnsBroadcaster", () => {
  it("skips publishing when disabled", () => {
    const broadcaster = new MdnsBroadcaster(createTestEnv({ mdnsEnabled: false }));
    broadcaster.start();
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes LAN service details when enabled", () => {
    publish.mockReturnValue({ stop });
    const broadcaster = new MdnsBroadcaster(
      createTestEnv({ mdnsEnabled: true, httpPort: 3000, mdnsServiceName: "bridge-packet" }),
    );

    broadcaster.start();

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "bridge-packet",
        type: "bridge-packet",
        port: 3000,
        txt: expect.objectContaining({ path: "/ws", announcedIp: "127.0.0.1" }),
      }),
    );
  });

  it("stops and destroys bonjour on shutdown", async () => {
    publish.mockReturnValue({ stop });
    const broadcaster = new MdnsBroadcaster(createTestEnv({ mdnsEnabled: true }));
    broadcaster.start();

    await broadcaster.stop();

    expect(stop).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("handles stop when service was never started", async () => {
    const broadcaster = new MdnsBroadcaster(createTestEnv({ mdnsEnabled: false }));
    await expect(broadcaster.stop()).resolves.toBeUndefined();
  });
});
