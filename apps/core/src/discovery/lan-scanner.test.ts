import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../test/helpers.js";
import { discoverMdnsServices } from "./mdns-browser.js";
import { enumerateHostAddresses, getLocalIPv4Networks } from "./network-interfaces.js";
import { LanScanner } from "./lan-scanner.js";
import { mapWithConcurrency, pingHost } from "./ping-probe.js";
import { reverse } from "node:dns/promises";

vi.mock("./network-interfaces.js", () => ({
  getLocalIPv4Networks: vi.fn(),
  enumerateHostAddresses: vi.fn(),
}));

vi.mock("./ping-probe.js", () => ({
  pingHost: vi.fn(),
  mapWithConcurrency: vi.fn(),
}));

vi.mock("./mdns-browser.js", () => ({
  discoverMdnsServices: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  reverse: vi.fn(),
}));

describe("LanScanner", () => {
  beforeEach(() => {
    vi.mocked(getLocalIPv4Networks).mockClear();
    vi.mocked(enumerateHostAddresses).mockClear();
    vi.mocked(mapWithConcurrency).mockClear();
    vi.mocked(pingHost).mockClear();
    vi.mocked(discoverMdnsServices).mockClear();
    vi.mocked(reverse).mockClear();
    vi.mocked(getLocalIPv4Networks).mockReturnValue([
      {
        interfaceName: "eth0",
        address: "192.168.1.50",
        netmask: "255.255.255.0",
        cidr: 24,
      },
    ]);
    vi.mocked(enumerateHostAddresses).mockReturnValue(["192.168.1.10", "192.168.1.20"]);
    vi.mocked(mapWithConcurrency).mockImplementation(async (items, _concurrency, mapper) =>
      Promise.all(items.map(mapper)),
    );
    vi.mocked(pingHost).mockImplementation(async (ip) => ({
      ip,
      alive: ip === "192.168.1.10",
      latencyMs: ip === "192.168.1.10" ? 2 : undefined,
    }));
    vi.mocked(discoverMdnsServices).mockResolvedValue(
      new Map([
        [
          "192.168.1.20",
          [{ name: "bridge-packet", type: "bridge-packet", port: 3000, txt: { path: "/ws" } }],
        ],
      ]),
    );
    vi.mocked(reverse).mockImplementation(async (ip) => (ip === "192.168.1.10" ? ["device.local"] : []));
  });

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
        services: [{ name: "bridge-packet", type: "bridge-packet", port: 3000, txt: { path: "/ws" } }],
      },
    ]);
  });

  it("merges mdns services into existing ping results", async () => {
    vi.mocked(discoverMdnsServices).mockResolvedValue(
      new Map([
        [
          "192.168.1.10",
          [{ name: "bridge-packet", type: "bridge-packet", port: 3000, txt: { path: "/ws" } }],
        ],
      ]),
    );

    const scanner = new LanScanner(createTestEnv({ lanScanMdnsEnabled: true }));
    const result = await scanner.scan();

    expect(result.devices[0]).toMatchObject({
      ip: "192.168.1.10",
      sources: ["ping", "mdns"],
      services: [{ name: "bridge-packet", type: "bridge-packet", port: 3000 }],
    });
  });

  it("skips mdns lookup when disabled", async () => {
    const scanner = new LanScanner(createTestEnv({ lanScanMdnsEnabled: false }));
    await scanner.scan();

    expect(discoverMdnsServices).not.toHaveBeenCalled();
  });

  it("keeps devices when reverse lookup fails", async () => {
    vi.mocked(reverse).mockRejectedValue(new Error("no PTR record"));

    const scanner = new LanScanner(createTestEnv({ lanScanMdnsEnabled: false }));
    const result = await scanner.scan();

    expect(result.devices[0]).toMatchObject({ ip: "192.168.1.10", latencyMs: 2 });
    expect(result.devices[0]?.hostname).toBeUndefined();
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

  it("logs when no devices are discovered", async () => {
    vi.mocked(pingHost).mockResolvedValue({ ip: "192.168.1.10", alive: false });
    vi.mocked(discoverMdnsServices).mockResolvedValue(new Map());

    const logger = { info: vi.fn(), warn: vi.fn() };
    const scanner = new LanScanner(createTestEnv({ lanScanMdnsEnabled: true }));

    await scanner.scanAndLog(logger);

    expect(logger.info).toHaveBeenCalledWith({}, "No LAN devices discovered during startup scan");
  });

  it("logs and rethrows scan failures", async () => {
    vi.mocked(getLocalIPv4Networks).mockImplementation(() => {
      throw new Error("network unavailable");
    });

    const logger = { info: vi.fn(), warn: vi.fn() };
    const scanner = new LanScanner(createTestEnv());

    await expect(scanner.scanAndLog(logger)).rejects.toThrow("network unavailable");
    expect(logger.warn).toHaveBeenCalledWith(
      { error: "network unavailable" },
      "LAN device scan failed",
    );
  });

  it("logs unknown scan failures", async () => {
    vi.mocked(getLocalIPv4Networks).mockImplementation(() => {
      throw "broken";
    });

    const logger = { info: vi.fn(), warn: vi.fn() };
    const scanner = new LanScanner(createTestEnv());

    await expect(scanner.scanAndLog(logger)).rejects.toBe("broken");
    expect(logger.warn).toHaveBeenCalledWith({ error: "Unknown scan error" }, "LAN device scan failed");
  });
});
