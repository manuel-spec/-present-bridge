import { reverse } from "node:dns/promises";
import type { Env } from "../config/env.js";
import { discoverMdnsServices } from "./mdns-browser.js";
import { enumerateHostAddresses, getLocalIPv4Networks } from "./network-interfaces.js";
import { mapWithConcurrency, pingHost } from "./ping-probe.js";
import type { LanDevice, LanScanResult, ScanLogger } from "./types.js";

export class LanScanner {
  constructor(private readonly env: Env) {}

  async scan(): Promise<LanScanResult> {
    const startedAt = Date.now();
    const networks = getLocalIPv4Networks();
    const excludeAddresses = networks.map((network) => network.address);
    const targetIps = [
      ...new Set(
        networks.flatMap((network) =>
          enumerateHostAddresses(network.address, network.netmask, excludeAddresses),
        ),
      ),
    ];

    const [pingResults, mdnsServicesByIp] = await Promise.all([
      mapWithConcurrency(targetIps, this.env.lanScanConcurrency, (ip) =>
        pingHost(ip, this.env.lanScanTimeoutMs),
      ),
      this.env.lanScanMdnsEnabled ? discoverMdnsServices(this.env.lanScanTimeoutMs) : Promise.resolve(new Map()),
    ]);

    const devices = new Map<string, LanDevice>();

    for (const result of pingResults) {
      if (!result.alive) {
        continue;
      }

      devices.set(result.ip, {
        ip: result.ip,
        latencyMs: result.latencyMs,
        sources: ["ping"],
        services: [],
      });
    }

    for (const [ip, services] of mdnsServicesByIp.entries()) {
      const existing = devices.get(ip);
      if (existing) {
        existing.sources = [...new Set([...existing.sources, "mdns"])] as Array<"ping" | "mdns">;
        existing.services = services;
        continue;
      }

      devices.set(ip, {
        ip,
        sources: ["mdns"],
        services,
      });
    }

    const resolvedDevices = await Promise.all(
      [...devices.values()].map(async (device) => {
        try {
          const hostnames = await reverse(device.ip);
          return { ...device, hostname: hostnames[0] };
        } catch {
          return device;
        }
      }),
    );

    resolvedDevices.sort((left, right) => left.ip.localeCompare(right.ip, undefined, { numeric: true }));

    return {
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      networks,
      devices: resolvedDevices,
    };
  }

  async scanAndLog(logger: ScanLogger): Promise<LanScanResult> {
    logger.info(
      {
        timeoutMs: this.env.lanScanTimeoutMs,
        concurrency: this.env.lanScanConcurrency,
        mdnsEnabled: this.env.lanScanMdnsEnabled,
      },
      "Starting LAN device scan",
    );

    try {
      const result = await this.scan();

      logger.info(
        {
          scannedAt: result.scannedAt,
          durationMs: result.durationMs,
          networkCount: result.networks.length,
          deviceCount: result.devices.length,
          networks: result.networks,
        },
        "LAN device scan completed",
      );

      if (result.devices.length === 0) {
        logger.info({}, "No LAN devices discovered during startup scan");
        return result;
      }

      for (const device of result.devices) {
        logger.info({ device }, "LAN device discovered");
      }

      return result;
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : "Unknown scan error" },
        "LAN device scan failed",
      );
      throw error;
    }
  }
}
