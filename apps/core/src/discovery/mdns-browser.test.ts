import { describe, expect, it, vi } from "vitest";
import { discoverMdnsServices } from "./mdns-browser.js";

const find = vi.fn();
const stop = vi.fn();
const destroy = vi.fn();

vi.mock("bonjour-service", () => ({
  default: vi.fn().mockImplementation(() => ({
    find,
    destroy,
  })),
}));

describe("discoverMdnsServices", () => {
  it("collects discovered services by IP", async () => {
    vi.useFakeTimers();
    const handlers = new Map<string, (service: unknown) => void>();

    find.mockImplementation(() => ({
      on: vi.fn((event: string, handler: (service: unknown) => void) => {
        if (event === "up") {
          handlers.set(`${handlers.size}`, handler);
        }
      }),
      stop,
    }));

    const promise = discoverMdnsServices(1000, ["packet-bridge"]);

    handlers.get("0")?.({
      name: "packet-bridge",
      type: "packet-bridge",
      host: "host.local",
      port: 3000,
      addresses: ["192.168.1.20"],
      txt: { path: "/ws" },
    });

    await vi.advanceTimersByTimeAsync(1000);
    const servicesByIp = await promise;

    expect(servicesByIp.get("192.168.1.20")).toEqual([
      {
        name: "packet-bridge",
        type: "packet-bridge",
        port: 3000,
        txt: { path: "/ws" },
      },
    ]);
    expect(stop).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });
});
