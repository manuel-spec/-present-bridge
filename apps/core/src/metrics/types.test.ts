import { describe, expect, it } from "vitest";
import {
  MetricsError,
  assertLabelNames,
  buildQualifiedName,
  deserializeLabels,
  emptyLabels,
  isHistogramSample,
  isMetricSample,
  labelsEqual,
  mergeLabels,
  sanitizeMetricNameSegment,
  serializeLabels,
  validateMetricName,
} from "./types.js";

describe("metrics/types", () => {
  it("builds qualified metric names with namespace and subsystem", () => {
    expect(buildQualifiedName("requests_total", "packet_bridge", "http")).toBe(
      "packet_bridge_http_requests_total",
    );
  });

  it("sanitizes invalid metric name segments", () => {
    expect(sanitizeMetricNameSegment("my-metric")).toBe("my_metric");
    expect(sanitizeMetricNameSegment("123bad")).toBe("_123bad");
    expect(sanitizeMetricNameSegment("")).toBe("unnamed");
  });

  it("validates metric names", () => {
    expect(validateMetricName("valid_metric").valid).toBe(true);
    expect(validateMetricName("").valid).toBe(false);
    expect(validateMetricName("9invalid").valid).toBe(false);
  });

  it("compares and serializes label sets", () => {
    const a = { room: "a", peer: "1" };
    const b = { peer: "1", room: "a" };
    expect(labelsEqual(a, b)).toBe(true);
    expect(serializeLabels(a)).toBe("peer=1,room=a");
    expect(deserializeLabels("peer=1,room=a")).toEqual({ peer: "1", room: "a" });
  });

  it("merges label sets with overrides winning", () => {
    expect(mergeLabels({ a: "1" }, { b: "2", a: "9" })).toEqual({ a: "9", b: "2" });
  });

  it("returns frozen empty labels", () => {
    const labels = emptyLabels();
    expect(labels).toEqual({});
    expect(Object.isFrozen(labels)).toBe(true);
  });

  it("asserts matching label name schemas", () => {
    expect(() => assertLabelNames(["a", "b"], ["a", "b"])).not.toThrow();
    expect(() => assertLabelNames(["a"], ["a", "b"])).toThrow(MetricsError);
  });

  it("identifies metric and histogram samples", () => {
    expect(
      isMetricSample({
        name: "test",
        type: "counter",
        help: "help",
        labels: {},
        value: 1,
      }),
    ).toBe(true);
    expect(isMetricSample(null)).toBe(false);

    expect(
      isHistogramSample({
        name: "test",
        help: "help",
        labels: {},
        buckets: [],
        sum: 0,
        count: 0,
      }),
    ).toBe(true);
    expect(isHistogramSample({})).toBe(false);
  });

  it("creates MetricsError with code", () => {
    const error = new MetricsError("DUPLICATE_METRIC", "duplicate");
    expect(error.code).toBe("DUPLICATE_METRIC");
    expect(error.name).toBe("MetricsError");
  });
});
