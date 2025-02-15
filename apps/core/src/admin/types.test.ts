import { describe, expect, it } from "vitest";
import {
  AdminError,
  ageSecondsFromIso,
  deriveHealthStatus,
  formatBytes,
  isDiagnosticFinding,
  severityPriority,
  sortFindingsBySeverity,
} from "./types.js";
import type { DiagnosticFinding } from "./types.js";

describe("admin/types", () => {
  it("prioritizes diagnostic severities", () => {
    expect(severityPriority("critical")).toBeGreaterThan(severityPriority("warning"));
    expect(severityPriority("info")).toBe(1);
  });

  it("derives health status from findings", () => {
    expect(deriveHealthStatus([])).toBe("healthy");
    expect(
      deriveHealthStatus([
        { code: "W", severity: "warning", message: "warn", component: "x" },
      ]),
    ).toBe("degraded");
    expect(
      deriveHealthStatus([
        { code: "E", severity: "error", message: "err", component: "x" },
      ]),
    ).toBe("unhealthy");
    expect(
      deriveHealthStatus([
        { code: "C", severity: "critical", message: "crit", component: "x" },
      ]),
    ).toBe("unhealthy");
  });

  it("sorts findings by severity descending", () => {
    const findings: DiagnosticFinding[] = [
      { code: "I", severity: "info", message: "i", component: "a" },
      { code: "C", severity: "critical", message: "c", component: "a" },
      { code: "W", severity: "warning", message: "w", component: "a" },
    ];
    const sorted = sortFindingsBySeverity(findings);
    expect(sorted[0]!.severity).toBe("critical");
    expect(sorted.at(-1)!.severity).toBe("info");
  });

  it("formats byte counts", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toContain("GB");
  });

  it("calculates age from ISO timestamps", () => {
    const now = Date.now();
    const iso = new Date(now - 10_000).toISOString();
    expect(ageSecondsFromIso(iso, now)).toBeCloseTo(10, 0);
    expect(ageSecondsFromIso("invalid", now)).toBe(0);
  });

  it("identifies diagnostic findings", () => {
    expect(
      isDiagnosticFinding({
        code: "X",
        severity: "info",
        message: "msg",
        component: "test",
      }),
    ).toBe(true);
    expect(isDiagnosticFinding(null)).toBe(false);
  });

  it("creates AdminError with code", () => {
    const error = new AdminError("PEER_NOT_FOUND", "missing");
    expect(error.code).toBe("PEER_NOT_FOUND");
    expect(error.name).toBe("AdminError");
  });
});
