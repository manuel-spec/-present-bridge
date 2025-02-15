import { describe, expect, it } from "vitest";
import type { RegistrySnapshot } from "./registry.js";
import {
  compareLabelSets,
  escapeHelpText,
  estimateOutputSize,
  formatHealthMetric,
  formatHistogram,
  formatMetricHeaders,
  formatMetricSamples,
  formatMetricValue,
  formatRegistrySnapshot,
  formatSampleLine,
  groupSamplesByName,
  prometheusContentType,
  validateFormattedOutput,
} from "./prometheus-formatter.js";

describe("prometheus-formatter", () => {
  const snapshot: RegistrySnapshot = {
    collectedAtMs: 1000,
    metricCount: 2,
    samples: [
      {
        name: "requests_total",
        type: "counter",
        help: "Total requests",
        labels: { method: "GET" },
        value: 42,
      },
      {
        name: "requests_total",
        type: "counter",
        help: "Total requests",
        labels: { method: "POST" },
        value: 7,
      },
      {
        name: "up",
        type: "gauge",
        help: "Server up",
        labels: {},
        value: 1,
      },
    ],
    histograms: [
      {
        name: "latency_seconds",
        help: "Latency",
        labels: { route: "/ws" },
        buckets: [
          { le: 0.1, count: 5 },
          { le: "+Inf", count: 10 },
        ],
        sum: 2.5,
        count: 10,
      },
    ],
  };

  it("formats a registry snapshot as prometheus text", () => {
    const output = formatRegistrySnapshot(snapshot);
    expect(output).toContain("# HELP requests_total Total requests");
    expect(output).toContain("# TYPE requests_total counter");
    expect(output).toContain('requests_total{method="GET"} 42');
    expect(output).toContain("latency_seconds_bucket");
    expect(output).toContain("latency_seconds_sum");
    expect(output).toContain("latency_seconds_count");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("formats individual sample lines", () => {
    const line = formatSampleLine(snapshot.samples[0]!);
    expect(line).toBe('requests_total{method="GET"} 42');
  });

  it("formats metric headers", () => {
    const headers = formatMetricHeaders("test", "gauge", "A test metric");
    expect(headers).toEqual(["# HELP test A test metric", "# TYPE test gauge"]);
  });

  it("escapes help text", () => {
    expect(escapeHelpText("line1\nline2")).toBe("line1\\nline2");
  });

  it("formats metric values without scientific notation", () => {
    expect(formatMetricValue(42)).toBe("42");
    expect(formatMetricValue(1.5)).toBe("1.5");
    expect(formatMetricValue(NaN)).toBe("NaN");
  });

  it("groups samples by name", () => {
    const grouped = groupSamplesByName(snapshot.samples);
    expect(grouped.get("requests_total")).toHaveLength(2);
  });

  it("compares label sets for sorting", () => {
    expect(compareLabelSets({ a: "1" }, { b: "2" })).toBeLessThan(0);
    expect(compareLabelSets({ a: "1" }, { a: "1" })).toBe(0);
  });

  it("validates formatted output", () => {
    const output = formatRegistrySnapshot(snapshot);
    const result = validateFormattedOutput(output);
    expect(result.valid).toBe(true);
  });

  it("formats histogram blocks", () => {
    const block = formatHistogram(snapshot.histograms[0]!);
    expect(block).toContain('le="0.1"');
    expect(block).toContain('le="+Inf"');
  });

  it("formats health metric", () => {
    expect(formatHealthMetric(true)).toContain("packet_bridge_up 1");
    expect(formatHealthMetric(false)).toContain("packet_bridge_up 0");
  });

  it("returns prometheus content type", () => {
    expect(prometheusContentType()).toContain("text/plain");
  });

  it("flags invalid formatted output", () => {
    const result = validateFormattedOutput("# BAD comment\nnot_a_metric");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("estimates formatted output size", () => {
    expect(estimateOutputSize(snapshot)).toBeGreaterThan(0);
  });

  it("formats registry without sorting metric names", () => {
    const output = formatRegistrySnapshot(snapshot, { sortMetrics: false });
    expect(output).toContain("requests_total");
    expect(output).toContain("up");
  });

  it("returns empty string for empty registry snapshot", () => {
    expect(
      formatRegistrySnapshot({
        collectedAtMs: 0,
        metricCount: 0,
        samples: [],
        histograms: [],
      }),
    ).toBe("");
  });

  it("formats samples without help headers and with timestamps", () => {
    const line = formatSampleLine(
      { ...snapshot.samples[0]!, timestampMs: 999 },
      { includeTimestamp: true },
    );
    expect(line).toContain("999");

    const headers = formatMetricHeaders("test", "gauge", "help", {
      includeHelp: false,
      includeType: false,
    });
    expect(headers).toEqual([]);
    expect(formatMetricSamples([])).toBe("");
  });

  it("formats histograms with timestamps when requested", () => {
    const output = formatRegistrySnapshot(
      {
        ...snapshot,
        histograms: [
          {
            ...snapshot.histograms[0]!,
            timestampMs: 1234567890,
          },
        ],
      },
      { includeTimestamp: true },
    );
    expect(output).toContain("1234567890");
  });
});
