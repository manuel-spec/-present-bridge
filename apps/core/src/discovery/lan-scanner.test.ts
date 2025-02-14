import { describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../test/helpers.js";
import { LanScanner } from "./lan-scanner.js";

vi.mock("./network-interfaces.js", () => ({
  getLocalIPv4Networks: vi.fn(() => [
    {
      interfaceName: "eth0",
      address: "192.168.1.50",
      netmask: "255.255.255.0",
      cidr: 24,
    },
  ]),
  enumerateHostAddresses: vi.fn(() => ["192.168.1.10", "192.168.1.20"]),
}));

vi.mock("./ping-probe.js", () => ({
  pingHost: vi.fn(async (ip: string) => ({
    ip,
    alive: ip === "192.168.1.10",
    latencyMs: ip === "192.168.1.10" ? 2 : undefined,
  })),
  mapWithConcurrency: vi.fn(async (items: string[], _concurrency: number, mapper: (item: string) => Promise<unknown>) =>
    Promise.all(items.map(mapper)),
  ),
}));

vi.mock("./mdns-browser.js", () => ({
  discoverMdnsServices: vi.fn(async () =>
    new Map([
      [
        "192.168.1.20",
        [{ name: "packet-bridge", type: "packet-bridge", port: 3000, txt: { path: "/ws" } }],
      ],
    ]),
  ),
}));

vi.mock("node:dns/promises", () => ({
  reverse: vi.fn(async (ip: string) => (ip === "192.168.1.10" ? ["device.local"] : [])),
}));

describe("LanScanner", () => {
  it("merges ping and mdns results", async () => {
    const scanner = new LanScanner(
      createTestEnv({ lanScanEnabled: true, lanScanMdnsEnabled: true, lanScanConcurrency: 2 }),
    );

    const result = await scanner.scan();

    expect(result.devices).toEqual([
      {
        ip: "192.168.1.10",
        hostname: "device.local",
        latencyMs: 2,
        sources: ["ping"],
        services: [],
      },
      {
        ip: "192.168.1.20",
        sources: ["mdns"],
        services: [{ name: "packet-bridge", type: "packet-bridge", port: 3000, txt: { path: "/ws" } }],
      },
    ]);
  });

  it("logs discovered devices", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const scanner = new LanScanner(createTestEnv({ lanScanMdnsEnabled: true }));

    await scanner.scanAndLog(logger);

    expect(logger.info).toHaveBeenCalledWith(expect.any(Object), "Starting LAN device scan");
    expect(logger.info).toHaveBeenCalledWith(expect.any(Object), "LAN device scan completed");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ device: expect.objectContaining({ ip: "192.168.1.10" }) }),
      "LAN device discovered",
    );
  });
});
