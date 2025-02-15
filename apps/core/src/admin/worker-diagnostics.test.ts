import { describe, expect, it, vi } from "vitest";
import { AdminError } from "./types.js";
import type { WorkerResourceUsage } from "./types.js";
import {
  WorkerDiagnostics,
  createWorkerDiagnostics,
  createWorkerProvider,
  normalizeResourceUsage,
} from "./worker-diagnostics.js";

const sampleUsage: WorkerResourceUsage = {
  ruUtime: 100,
  ruStime: 50,
  ruMaxRss: 2_097_152,
  ruIxrss: 0,
  ruIdrss: 0,
  ruIsrss: 0,
  ruMinflt: 10,
  ruMajflt: 0,
  ruNswap: 0,
  ruInblock: 0,
  ruOublock: 0,
  ruMsgsnd: 0,
  ruMsgrcv: 0,
  ruNsignals: 0,
  ruNvcsw: 100,
  ruNivcsw: 5,
};

describe("worker-diagnostics", () => {
  it("returns empty snapshot without provider", async () => {
    const diagnostics = createWorkerDiagnostics(null);
    const snapshot = await diagnostics.collect();
    expect(snapshot.workerCount).toBe(0);
    expect(snapshot.workers).toEqual([]);
    expect(diagnostics.hasProvider()).toBe(false);
  });

  it("collects worker resource usage", async () => {
    const provider = createWorkerProvider([
      {
        pid: 1001,
        getResourceUsage: vi.fn().mockResolvedValue(sampleUsage),
      },
      {
        pid: 1002,
        getResourceUsage: vi.fn().mockResolvedValue(sampleUsage),
      },
    ]);

    const diagnostics = new WorkerDiagnostics(provider);
    const snapshot = await diagnostics.collect();

    expect(snapshot.workerCount).toBe(2);
    expect(snapshot.aliveCount).toBe(2);
    expect(snapshot.workers[0]!.resourceUsage?.ruUtime).toBe(100);
  });

  it("marks workers as not alive on failure", async () => {
    const provider = createWorkerProvider([
      {
        pid: 2001,
        getResourceUsage: vi.fn().mockRejectedValue(new Error("worker dead")),
      },
    ]);

    const diagnostics = new WorkerDiagnostics(provider, { timeoutMs: 100 });
    const snapshot = await diagnostics.collect();

    expect(snapshot.aliveCount).toBe(0);
    expect(snapshot.workers[0]!.alive).toBe(false);
    expect(snapshot.workers[0]!.error).toContain("worker dead");
  });

  it("collects a single worker by index", async () => {
    const provider = createWorkerProvider([
      { pid: 3001, getResourceUsage: vi.fn().mockResolvedValue(sampleUsage) },
    ]);
    const diagnostics = new WorkerDiagnostics(provider);
    const entry = await diagnostics.collectWorker(0);
    expect(entry.pid).toBe(3001);
    expect(entry.alive).toBe(true);
  });

  it("throws when collecting unknown worker index", async () => {
    const diagnostics = new WorkerDiagnostics(createWorkerProvider([]));
    await expect(diagnostics.collectWorker(0)).rejects.toThrow(AdminError);
  });

  it("throws when no provider configured", async () => {
    const diagnostics = new WorkerDiagnostics(null);
    await expect(diagnostics.collectWorker(0)).rejects.toThrow(AdminError);
  });

  it("analyzes worker health findings", async () => {
    const noWorkers = new WorkerDiagnostics(null);
    expect(noWorkers.analyze(await noWorkers.collect()).some((f) => f.code === "NO_WORKERS")).toBe(
      true,
    );

    const provider = createWorkerProvider([
      { pid: 1, getResourceUsage: vi.fn().mockResolvedValue(sampleUsage) },
    ]);
    const healthy = new WorkerDiagnostics(provider);
    const findings = healthy.analyze(await healthy.collect());
    expect(findings.some((f) => f.code === "WORKERS_HEALTHY")).toBe(true);
  });

  it("aggregates resource usage across workers", async () => {
    const provider = createWorkerProvider([
      { pid: 1, getResourceUsage: vi.fn().mockResolvedValue(sampleUsage) },
      { pid: 2, getResourceUsage: vi.fn().mockResolvedValue(sampleUsage) },
    ]);
    const diagnostics = new WorkerDiagnostics(provider);
    const snapshot = await diagnostics.collect();
    const aggregated = diagnostics.aggregateResourceUsage(snapshot);
    expect(aggregated?.ruUtime).toBe(200);
  });

  it("returns null when aggregating empty resource usage", async () => {
    const provider = createWorkerProvider([
      { pid: 1, getResourceUsage: vi.fn().mockRejectedValue(new Error("dead")) },
    ]);
    const diagnostics = new WorkerDiagnostics(provider);
    const snapshot = await diagnostics.collect();
    expect(diagnostics.aggregateResourceUsage(snapshot)).toBeNull();
    expect(snapshot.workers[0]!.error).toBeTruthy();
    const findings = diagnostics.analyze(snapshot);
    expect(findings.some((f) => f.code === "WORKER_STATS_ERROR")).toBe(true);
  });

  it("records non-error failures as worker errors", async () => {
    const provider = createWorkerProvider([
      { pid: 1, getResourceUsage: vi.fn().mockRejectedValue("plain failure") },
    ]);
    const diagnostics = new WorkerDiagnostics(provider);
    const snapshot = await diagnostics.collect();
    expect(snapshot.workers[0]!.error).toBe("plain failure");
  });

  it("normalizes resource usage with defaults", () => {
    const normalized = normalizeResourceUsage({ ruUtime: 5 } as WorkerResourceUsage);
    expect(normalized.ruUtime).toBe(5);
    expect(normalized.ruStime).toBe(0);
  });
});
