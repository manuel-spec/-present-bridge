import os from "node:os";
import type {
  CpuDiagnostics,
  DiagnosticFinding,
  MemoryDiagnostics,
  NetworkInterfaceDiagnostics,
  ServerDiagnosticsSnapshot,
} from "./types.js";

/** Thresholds for generating memory-related diagnostic findings. */
export interface MemoryThresholds {
  readonly heapWarningPercent: number;
  readonly heapCriticalPercent: number;
  readonly systemFreeWarningBytes: number;
}

const DEFAULT_MEMORY_THRESHOLDS: MemoryThresholds = {
  heapWarningPercent: 85,
  heapCriticalPercent: 95,
  systemFreeWarningBytes: 256 * 1024 * 1024,
};

/** Options for server diagnostic collection. */
export interface ServerDiagnosticsOptions {
  readonly startTimeMs?: number;
  readonly includeNetworkInterfaces?: boolean;
  readonly memoryThresholds?: MemoryThresholds;
  readonly networkInterfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
}

/**
 * Collects CPU, memory, uptime, and network interface diagnostics
 * from the Node.js process and host operating system.
 */
export class ServerDiagnostics {
  private readonly startTimeMs: number;
  private readonly memoryThresholds: MemoryThresholds;

  constructor(options: ServerDiagnosticsOptions = {}) {
    this.startTimeMs = options.startTimeMs ?? Date.now();
    this.memoryThresholds = options.memoryThresholds ?? DEFAULT_MEMORY_THRESHOLDS;
  }

  getStartTimeMs(): number {
    return this.startTimeMs;
  }

  /** Collects a full server diagnostics snapshot. */
  collect(options: ServerDiagnosticsOptions = {}): ServerDiagnosticsSnapshot {
    const now = Date.now();
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const memory = process.memoryUsage();
    const systemTotal = os.totalmem();
    const systemFree = os.freemem();

    const cpu: CpuDiagnostics = {
      coreCount: cpus.length,
      model: cpus[0]?.model ?? "unknown",
      speedMhz: cpus[0]?.speed ?? 0,
      loadAverage1m: loadAvg[0] ?? 0,
      loadAverage5m: loadAvg[1] ?? 0,
      loadAverage15m: loadAvg[2] ?? 0,
      utilizationPercent: this.estimateCpuUtilization(loadAvg[0] ?? 0, cpus.length),
    };

    const heapUsedPercent = memory.heapTotal > 0
      ? (memory.heapUsed / memory.heapTotal) * 100
      : 0;

    const memoryDiagnostics: MemoryDiagnostics = {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      systemTotalBytes: systemTotal,
      systemFreeBytes: systemFree,
      heapUsedPercent,
    };

    const includeNetwork = options.includeNetworkInterfaces !== false;
    const networkInterfaces = includeNetwork
      ? this.collectNetworkInterfaces(options.networkInterfaces ?? os.networkInterfaces())
      : [];

    return {
      collectedAtMs: now,
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
      uptimeSeconds: (now - this.startTimeMs) / 1000,
      startTimeMs: this.startTimeMs,
      cpu,
      memory: memoryDiagnostics,
      networkInterfaces,
    };
  }

  /** Analyzes a snapshot and returns diagnostic findings. */
  analyze(snapshot: ServerDiagnosticsSnapshot): DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];

    if (snapshot.memory.heapUsedPercent >= this.memoryThresholds.heapCriticalPercent) {
      findings.push({
        code: "HEAP_CRITICAL",
        severity: "critical",
        component: "memory",
        message: `Heap usage at ${snapshot.memory.heapUsedPercent.toFixed(1)}%`,
        remediation: "Investigate memory leaks or increase available memory",
        metadata: {
          heapUsedBytes: snapshot.memory.heapUsedBytes,
          heapTotalBytes: snapshot.memory.heapTotalBytes,
        },
      });
    } else if (snapshot.memory.heapUsedPercent >= this.memoryThresholds.heapWarningPercent) {
      findings.push({
        code: "HEAP_HIGH",
        severity: "warning",
        component: "memory",
        message: `Heap usage at ${snapshot.memory.heapUsedPercent.toFixed(1)}%`,
        remediation: "Monitor heap growth trend",
      });
    }

    if (snapshot.memory.systemFreeBytes < this.memoryThresholds.systemFreeWarningBytes) {
      findings.push({
        code: "SYSTEM_MEMORY_LOW",
        severity: "warning",
        component: "memory",
        message: `System free memory is ${snapshot.memory.systemFreeBytes} bytes`,
        remediation: "Ensure sufficient host memory for mediasoup workers",
      });
    }

    if (snapshot.cpu.utilizationPercent > 90) {
      findings.push({
        code: "CPU_HIGH",
        severity: "warning",
        component: "cpu",
        message: `Estimated CPU utilization at ${snapshot.cpu.utilizationPercent.toFixed(1)}%`,
      });
    }

    const privateInterfaces = snapshot.networkInterfaces.filter(
      (iface) => !iface.internal && iface.family === "IPv4",
    );
    if (privateInterfaces.length === 0) {
      findings.push({
        code: "NO_PRIVATE_IPV4",
        severity: "warning",
        component: "network",
        message: "No non-internal IPv4 network interfaces detected",
        remediation: "Verify ANNOUNCED_IP is set to a reachable LAN address",
      });
    }

    if (snapshot.uptimeSeconds < 30) {
      findings.push({
        code: "RECENT_START",
        severity: "info",
        component: "process",
        message: `Server started ${snapshot.uptimeSeconds.toFixed(0)} seconds ago`,
      });
    }

    return findings;
  }

  /** Returns only CPU diagnostics. */
  collectCpu(): CpuDiagnostics {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    return {
      coreCount: cpus.length,
      model: cpus[0]?.model ?? "unknown",
      speedMhz: cpus[0]?.speed ?? 0,
      loadAverage1m: loadAvg[0] ?? 0,
      loadAverage5m: loadAvg[1] ?? 0,
      loadAverage15m: loadAvg[2] ?? 0,
      utilizationPercent: this.estimateCpuUtilization(loadAvg[0] ?? 0, cpus.length),
    };
  }

  /** Returns only memory diagnostics. */
  collectMemory(): MemoryDiagnostics {
    const memory = process.memoryUsage();
    const heapUsedPercent = memory.heapTotal > 0
      ? (memory.heapUsed / memory.heapTotal) * 100
      : 0;
    return {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      systemTotalBytes: os.totalmem(),
      systemFreeBytes: os.freemem(),
      heapUsedPercent,
    };
  }

  /** Returns process uptime in seconds. */
  getUptimeSeconds(nowMs = Date.now()): number {
    return (nowMs - this.startTimeMs) / 1000;
  }

  private collectNetworkInterfaces(
    interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
  ): NetworkInterfaceDiagnostics[] {
    const result: NetworkInterfaceDiagnostics[] = [];

    for (const [name, entries] of Object.entries(interfaces)) {
      if (!entries) {
        continue;
      }
      for (const entry of entries) {
        result.push({
          name,
          address: entry.address,
          netmask: entry.netmask,
          family: String(entry.family),
          internal: entry.internal,
          mac: entry.mac,
          cidr: "cidr" in entry ? (entry.cidr as number | null) : null,
        });
      }
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  private estimateCpuUtilization(load1m: number, coreCount: number): number {
    if (coreCount === 0) {
      return 0;
    }
    const utilization = (load1m / coreCount) * 100;
    return Math.min(100, Math.max(0, utilization));
  }
}

export function createServerDiagnostics(startTimeMs?: number): ServerDiagnostics {
  return new ServerDiagnostics({ startTimeMs });
}

export function netmaskToCidr(netmask: string): number {
  return netmask
    .split(".")
    .map((octet) => Number(octet))
    .reduce((acc, octet) => acc + octet.toString(2).replace(/0/g, "").length, 0);
}

export function filterPublicInterfaces(
  interfaces: readonly NetworkInterfaceDiagnostics[],
): NetworkInterfaceDiagnostics[] {
  return interfaces.filter((iface) => !iface.internal && iface.family === "IPv4");
}
