import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ServerDiagnostics,
  createServerDiagnostics,
  filterPublicInterfaces,
  netmaskToCidr,
} from "./server-diagnostics.js";

describe("server-diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("collects a full server diagnostics snapshot", () => {
    const diagnostics = createServerDiagnostics(Date.now() - 60_000);
    const snapshot = diagnostics.collect();

    expect(snapshot.hostname).toBeTruthy();
    expect(snapshot.pid).toBe(process.pid);
    expect(snapshot.uptimeSeconds).toBeGreaterThan(0);
    expect(snapshot.cpu.coreCount).toBeGreaterThan(0);
    expect(snapshot.memory.heapUsedBytes).toBeGreaterThan(0);
    expect(snapshot.networkInterfaces.length).toBeGreaterThanOrEqual(0);
  });

  it("collects CPU diagnostics only", () => {
    const diagnostics = new ServerDiagnostics();
    const cpu = diagnostics.collectCpu();
    expect(cpu.coreCount).toBeGreaterThan(0);
    expect(cpu.utilizationPercent).toBeGreaterThanOrEqual(0);
    expect(cpu.utilizationPercent).toBeLessThanOrEqual(100);
  });

  it("collects memory diagnostics only", () => {
    const diagnostics = new ServerDiagnostics();
    const memory = diagnostics.collectMemory();
    expect(memory.rssBytes).toBeGreaterThan(0);
    expect(memory.systemTotalBytes).toBeGreaterThan(0);
    expect(memory.heapUsedPercent).toBeGreaterThanOrEqual(0);
  });

  it("skips network interfaces when disabled", () => {
    const diagnostics = new ServerDiagnostics();
    const snapshot = diagnostics.collect({ includeNetworkInterfaces: false });
    expect(snapshot.networkInterfaces).toEqual([]);
  });

  it("uses custom network interface data", () => {
    const diagnostics = new ServerDiagnostics();
    const snapshot = diagnostics.collect({
      networkInterfaces: {
        eth0: [
          {
            family: "IPv4",
            address: "192.168.1.10",
            netmask: "255.255.255.0",
            internal: false,
            mac: "00:00:00:00:00:00",
            cidr: 24,
            scopeid: 0,
          },
        ],
      },
    });
    expect(snapshot.networkInterfaces).toHaveLength(1);
    expect(snapshot.networkInterfaces[0]!.address).toBe("192.168.1.10");
  });

  it("analyzes high heap usage", () => {
    const diagnostics = new ServerDiagnostics({
      memoryThresholds: { heapWarningPercent: 1, heapCriticalPercent: 2, systemFreeWarningBytes: 0 },
    });
    const snapshot = diagnostics.collect();
    const findings = diagnostics.analyze(snapshot);
    expect(findings.some((f) => f.code === "HEAP_HIGH" || f.code === "HEAP_CRITICAL")).toBe(true);
  });

  it("reports recent start for young processes", () => {
    const diagnostics = new ServerDiagnostics({ startTimeMs: Date.now() });
    const findings = diagnostics.analyze(diagnostics.collect());
    expect(findings.some((f) => f.code === "RECENT_START")).toBe(true);
  });

  it("converts netmask to CIDR", () => {
    expect(netmaskToCidr("255.255.255.0")).toBe(24);
  });

  it("filters public interfaces", () => {
    const filtered = filterPublicInterfaces([
      {
        name: "lo",
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        internal: true,
        mac: "",
        cidr: 8,
      },
      {
        name: "eth0",
        address: "192.168.1.1",
        netmask: "255.255.255.0",
        family: "IPv4",
        internal: false,
        mac: "",
        cidr: 24,
      },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.name).toBe("eth0");
  });

  it("returns uptime in seconds", () => {
    const start = Date.now() - 5000;
    const diagnostics = new ServerDiagnostics({ startTimeMs: start });
    expect(diagnostics.getUptimeSeconds()).toBeCloseTo(5, 0);
    expect(diagnostics.getStartTimeMs()).toBe(start);
  });

  it("reports heap warning without critical severity", () => {
    const diagnostics = new ServerDiagnostics({
      memoryThresholds: {
        heapWarningPercent: 50,
        heapCriticalPercent: 90,
        systemFreeWarningBytes: 0,
      },
    });
    const snapshot = {
      ...diagnostics.collect(),
      memory: {
        ...diagnostics.collectMemory(),
        heapUsedPercent: 60,
      },
    };
    const findings = diagnostics.analyze(snapshot);
    expect(findings.some((f) => f.code === "HEAP_HIGH")).toBe(true);
    expect(findings.some((f) => f.code === "HEAP_CRITICAL")).toBe(false);
  });

  it("reports critical heap usage", () => {
    const diagnostics = new ServerDiagnostics({
      memoryThresholds: { heapWarningPercent: 1, heapCriticalPercent: 1, systemFreeWarningBytes: 0 },
    });
    const findings = diagnostics.analyze(diagnostics.collect());
    expect(findings.some((f) => f.code === "HEAP_CRITICAL")).toBe(true);
  });

  it("reports low system memory", () => {
    const diagnostics = new ServerDiagnostics({
      memoryThresholds: {
        heapWarningPercent: 100,
        heapCriticalPercent: 100,
        systemFreeWarningBytes: Number.MAX_SAFE_INTEGER,
      },
    });
    const findings = diagnostics.analyze(diagnostics.collect());
    expect(findings.some((f) => f.code === "SYSTEM_MEMORY_LOW")).toBe(true);
  });

  it("reports high cpu utilization", () => {
    const diagnostics = new ServerDiagnostics();
    const findings = diagnostics.analyze({
      ...diagnostics.collect(),
      cpu: {
        coreCount: 1,
        model: "test",
        speedMhz: 1000,
        loadAverage1m: 2,
        loadAverage5m: 2,
        loadAverage15m: 2,
        utilizationPercent: 95,
      },
    });
    expect(findings.some((f) => f.code === "CPU_HIGH")).toBe(true);
  });

  it("warns when no private ipv4 interfaces exist", () => {
    const diagnostics = new ServerDiagnostics();
    const findings = diagnostics.analyze({
      ...diagnostics.collect({ includeNetworkInterfaces: false }),
      networkInterfaces: [
        {
          name: "lo",
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4",
          internal: true,
          mac: "",
          cidr: 8,
        },
      ],
    });
    expect(findings.some((f) => f.code === "NO_PRIVATE_IPV4")).toBe(true);
  });

  it("collects snapshot with zero heap utilization when heap total is zero", () => {
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 100,
      heapUsed: 50,
      heapTotal: 0,
      external: 0,
      arrayBuffers: 0,
    });

    const snapshot = new ServerDiagnostics().collect();
    expect(snapshot.memory.heapUsedPercent).toBe(0);
  });

  it("defaults missing cpu and load average fields", () => {
    vi.spyOn(os, "cpus").mockReturnValue([]);
    vi.spyOn(os, "loadavg").mockReturnValue([1.2] as ReturnType<typeof os.loadavg>);

    const cpu = new ServerDiagnostics().collectCpu();
    expect(cpu.model).toBe("unknown");
    expect(cpu.speedMhz).toBe(0);
    expect(cpu.loadAverage5m).toBe(0);
    expect(cpu.loadAverage15m).toBe(0);
  });

  it("defaults missing cpu fields in full collect snapshot", () => {
    vi.spyOn(os, "cpus").mockReturnValue([]);
    vi.spyOn(os, "loadavg").mockReturnValue([] as unknown as ReturnType<typeof os.loadavg>);

    const snapshot = new ServerDiagnostics().collect();
    expect(snapshot.cpu.model).toBe("unknown");
    expect(snapshot.cpu.speedMhz).toBe(0);
    expect(snapshot.cpu.loadAverage1m).toBe(0);
    expect(snapshot.cpu.loadAverage5m).toBe(0);
    expect(snapshot.cpu.loadAverage15m).toBe(0);
  });

  it("handles zero cpu cores and zero heap total", () => {
    vi.spyOn(os, "cpus").mockReturnValue([]);
    vi.spyOn(os, "loadavg").mockReturnValue([2, 2, 2]);
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 0,
      heapUsed: 0,
      heapTotal: 0,
      external: 0,
      arrayBuffers: 0,
    });

    const diagnostics = new ServerDiagnostics();
    const cpu = diagnostics.collectCpu();
    expect(cpu.coreCount).toBe(0);
    expect(cpu.utilizationPercent).toBe(0);
    expect(diagnostics.collectMemory().heapUsedPercent).toBe(0);
  });

  it("returns zero cpu utilization when no cores reported", () => {
    const diagnostics = new ServerDiagnostics();
    const cpu = diagnostics.collectCpu();
    expect(cpu.utilizationPercent).toBeGreaterThanOrEqual(0);
    const findings = diagnostics.analyze({
      ...diagnostics.collect(),
      cpu: { ...cpu, coreCount: 0, utilizationPercent: 0 },
      uptimeSeconds: 120,
    });
    expect(findings.some((f) => f.code === "RECENT_START")).toBe(false);
  });

  it("skips null network interface entries", () => {
    const diagnostics = new ServerDiagnostics();
    const snapshot = diagnostics.collect({
      networkInterfaces: {
        eth0: null,
        lo: [
          {
            family: "IPv4",
            address: "127.0.0.1",
            netmask: "255.0.0.0",
            internal: true,
            mac: "00:00:00:00:00:00",
            scopeid: 0,
          },
        ],
      },
    });
    expect(snapshot.networkInterfaces).toHaveLength(1);
    expect(snapshot.networkInterfaces[0]!.cidr).toBeNull();
  });
});
