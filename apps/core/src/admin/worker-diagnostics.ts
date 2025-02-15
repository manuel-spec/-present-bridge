import type {
  DiagnosticFinding,
  WorkerDiagnosticsEntry,
  WorkerDiagnosticsSnapshot,
  WorkerProvider,
  WorkerResourceUsage,
} from "./types.js";
import { AdminError } from "./types.js";

/** Options for worker diagnostic collection. */
export interface WorkerDiagnosticsOptions {
  readonly timeoutMs?: number;
}

const DEFAULT_WORKER_OPTIONS: Required<WorkerDiagnosticsOptions> = {
  timeoutMs: 5000,
};

/**
 * Wraps mediasoup worker instances and collects resource usage statistics.
 * Accepts a WorkerProvider to avoid modifying WorkerPool internals.
 */
export class WorkerDiagnostics {
  private readonly provider: WorkerProvider | null;
  private readonly options: Required<WorkerDiagnosticsOptions>;

  constructor(provider: WorkerProvider | null, options: WorkerDiagnosticsOptions = {}) {
    this.provider = provider;
    this.options = { ...DEFAULT_WORKER_OPTIONS, ...options };
  }

  /** Returns whether a worker provider is configured. */
  hasProvider(): boolean {
    return this.provider !== null;
  }

  /** Collects diagnostics for all available workers. */
  async collect(): Promise<WorkerDiagnosticsSnapshot> {
    const collectedAtMs = Date.now();

    if (!this.provider) {
      return {
        collectedAtMs,
        workerCount: 0,
        aliveCount: 0,
        workers: [],
      };
    }

    const rawWorkers = this.provider.getWorkers();
    const workers: WorkerDiagnosticsEntry[] = [];

    for (let index = 0; index < rawWorkers.length; index += 1) {
      const worker = rawWorkers[index]!;
      const entry = await this.collectWorkerEntry(worker, index);
      workers.push(entry);
    }

    const aliveCount = workers.filter((w) => w.alive).length;

    return {
      collectedAtMs,
      workerCount: workers.length,
      aliveCount,
      workers: Object.freeze(workers),
    };
  }

  /** Collects diagnostics for a single worker by index. */
  async collectWorker(index: number): Promise<WorkerDiagnosticsEntry> {
    if (!this.provider) {
      throw new AdminError("WORKER_UNAVAILABLE", "No worker provider configured");
    }
    const workers = this.provider.getWorkers();
    const worker = workers[index];
    if (!worker) {
      throw new AdminError("WORKER_UNAVAILABLE", `Worker index ${index} not found`);
    }
    return this.collectWorkerEntry(worker, index);
  }

  /** Analyzes worker snapshot and returns findings. */
  analyze(snapshot: WorkerDiagnosticsSnapshot): DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];

    if (snapshot.workerCount === 0) {
      findings.push({
        code: "NO_WORKERS",
        severity: "critical",
        component: "mediasoup",
        message: "No mediasoup workers are configured",
        remediation: "Start the WorkerPool before accepting media connections",
      });
      return findings;
    }

    const deadWorkers = snapshot.workers.filter((w) => !w.alive);
    if (deadWorkers.length > 0) {
      findings.push({
        code: "WORKERS_DEAD",
        severity: "critical",
        component: "mediasoup",
        message: `${deadWorkers.length} of ${snapshot.workerCount} workers are not responding`,
        metadata: { deadPids: deadWorkers.map((w) => w.pid) },
      });
    }

    for (const worker of snapshot.workers) {
      if (worker.resourceUsage && worker.resourceUsage.ruMaxRss > 0) {
        const rssMb = worker.resourceUsage.ruMaxRss / 1024;
        if (rssMb > 1024) {
          findings.push({
            code: "WORKER_MEMORY_HIGH",
            severity: "warning",
            component: "mediasoup",
            message: `Worker ${worker.pid} max RSS is ${rssMb.toFixed(0)} MB`,
            metadata: { workerIndex: worker.workerIndex, pid: worker.pid },
          });
        }
      }
      if (worker.error) {
        findings.push({
          code: "WORKER_STATS_ERROR",
          severity: "warning",
          component: "mediasoup",
          message: `Failed to collect stats for worker ${worker.pid}: ${worker.error}`,
          metadata: { workerIndex: worker.workerIndex },
        });
      }
    }

    if (snapshot.aliveCount === snapshot.workerCount) {
      findings.push({
        code: "WORKERS_HEALTHY",
        severity: "info",
        component: "mediasoup",
        message: `All ${snapshot.workerCount} mediasoup workers are alive`,
      });
    }

    return findings;
  }

  /** Aggregates total resource usage across all workers. */
  aggregateResourceUsage(snapshot: WorkerDiagnosticsSnapshot): WorkerResourceUsage | null {
    const usages = snapshot.workers
      .map((w) => w.resourceUsage)
      .filter((u): u is WorkerResourceUsage => u !== null);

    if (usages.length === 0) {
      return null;
    }

    const sum = (key: keyof WorkerResourceUsage) =>
      usages.reduce((total, usage) => total + (usage[key] ?? 0), 0);

    return {
      ruUtime: sum("ruUtime"),
      ruStime: sum("ruStime"),
      ruMaxRss: sum("ruMaxRss"),
      ruIxrss: sum("ruIxrss"),
      ruIdrss: sum("ruIdrss"),
      ruIsrss: sum("ruIsrss"),
      ruMinflt: sum("ruMinflt"),
      ruMajflt: sum("ruMajflt"),
      ruNswap: sum("ruNswap"),
      ruInblock: sum("ruInblock"),
      ruOublock: sum("ruOublock"),
      ruMsgsnd: sum("ruMsgsnd"),
      ruMsgrcv: sum("ruMsgrcv"),
      ruNsignals: sum("ruNsignals"),
      ruNvcsw: sum("ruNvcsw"),
      ruNivcsw: sum("ruNivcsw"),
    };
  }

  private async collectWorkerEntry(
    worker: { pid: number; getResourceUsage(): Promise<WorkerResourceUsage> },
    index: number,
  ): Promise<WorkerDiagnosticsEntry> {
    try {
      const resourceUsage = await this.withTimeout(
        worker.getResourceUsage(),
        this.options.timeoutMs,
      );
      return {
        workerIndex: index,
        pid: worker.pid,
        alive: true,
        resourceUsage: normalizeResourceUsage(resourceUsage),
      };
    } catch (error) {
      return {
        workerIndex: index,
        pid: worker.pid,
        alive: false,
        resourceUsage: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AdminError("COLLECTION_FAILED", `Worker stats timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}

/** Creates a WorkerProvider from an array of mediasoup-like workers. */
export function createWorkerProvider(
  workers: Array<{ pid: number; getResourceUsage(): Promise<WorkerResourceUsage> }>,
): WorkerProvider {
  return {
    getWorkers: () => workers,
  };
}

/** Normalizes mediasoup resource usage to our diagnostic shape. */
export function normalizeResourceUsage(raw: WorkerResourceUsage): WorkerResourceUsage {
  return {
    ruUtime: raw.ruUtime ?? 0,
    ruStime: raw.ruStime ?? 0,
    ruMaxRss: raw.ruMaxRss ?? 0,
    ruIxrss: raw.ruIxrss ?? 0,
    ruIdrss: raw.ruIdrss ?? 0,
    ruIsrss: raw.ruIsrss ?? 0,
    ruMinflt: raw.ruMinflt ?? 0,
    ruMajflt: raw.ruMajflt ?? 0,
    ruNswap: raw.ruNswap ?? 0,
    ruInblock: raw.ruInblock ?? 0,
    ruOublock: raw.ruOublock ?? 0,
    ruMsgsnd: raw.ruMsgsnd ?? 0,
    ruMsgrcv: raw.ruMsgrcv ?? 0,
    ruNsignals: raw.ruNsignals ?? 0,
    ruNvcsw: raw.ruNvcsw ?? 0,
    ruNivcsw: raw.ruNivcsw ?? 0,
  };
}

export function createWorkerDiagnostics(
  provider: WorkerProvider | null,
  options?: WorkerDiagnosticsOptions,
): WorkerDiagnostics {
  return new WorkerDiagnostics(provider, options);
}
