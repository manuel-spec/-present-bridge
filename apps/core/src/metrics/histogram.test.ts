import { describe, expect, it } from "vitest";
import { MetricsError } from "./types.js";
import {
  Histogram,
  LabeledHistogram,
  createHistogram,
  histogramMean,
} from "./histogram.js";

describe("Histogram", () => {
  it("observes values into buckets", () => {
    const histogram = createHistogram("latency", "Request latency");
    histogram.observe(0.01);
    histogram.observe(0.05);
    histogram.observe(0.5);

    expect(histogram.getCount()).toBe(3);
    expect(histogram.getSum()).toBeCloseTo(0.56);
  });

  it("tracks labeled histogram series", () => {
    const histogram = new Histogram("duration", {
      help: "Duration",
      labelNames: ["route"],
      buckets: [0.1, 0.5, 1],
    });
    histogram.observe({ route: "/ws" }, 0.2);
    histogram.observe({ route: "/ws" }, 0.8);

    expect(histogram.getCount({ route: "/ws" })).toBe(2);
    const buckets = histogram.getBucketCounts({ route: "/ws" });
    expect(buckets.at(-1)!.count).toBe(2);
  });

  it("exposes histogram name and bucket metadata", () => {
    const histogram = new Histogram("latency_seconds", {
      help: "latency",
      namespace: "app",
      buckets: [0.1, 1],
    });
    expect(histogram.name).toContain("latency_seconds");
    expect(histogram.buckets).toEqual([0.1, 1]);
  });

  it("rejects invalid metric names at construction", () => {
    expect(() => new Histogram("bad-name", { help: "bad", buckets: [1] })).toThrow(MetricsError);
  });

  it("rejects invalid observations", () => {
    const histogram = createHistogram("bad", "bad");
    expect(() => histogram.observe(-1)).toThrow(MetricsError);
    expect(() => histogram.observe(NaN)).toThrow(MetricsError);
  });

  it("rejects non-increasing bucket boundaries", () => {
    expect(
      () =>
        new Histogram("bad_buckets", {
          help: "bad",
          buckets: [1, 0.5],
        }),
    ).toThrow(MetricsError);
  });

  it("rejects empty bucket list", () => {
    expect(
      () =>
        new Histogram("empty_buckets", {
          help: "bad",
          buckets: [],
        }),
    ).toThrow(MetricsError);
  });

  it("collects histogram samples with bucket data", () => {
    const histogram = createHistogram("collect", "collect", { buckets: [1, 5] });
    histogram.observe(0.5);
    const samples = histogram.collect();
    expect(samples).toHaveLength(1);
    expect(samples[0]!.count).toBe(1);
    expect(samples[0]!.buckets.length).toBeGreaterThan(0);
  });

  it("supports labeled child histograms", () => {
    const histogram = new Histogram("child", {
      help: "child",
      labelNames: ["method"],
      buckets: [1],
    });
    const child = histogram.labels("GET");
    child.observe(0.5);
    expect(child.getCount()).toBe(1);
    expect(child).toBeInstanceOf(LabeledHistogram);
  });

  it("computes histogram mean", () => {
    const histogram = createHistogram("mean", "mean");
    histogram.observe(2);
    histogram.observe(4);
    expect(histogramMean(histogram)).toBe(3);
    expect(histogramMean(histogram, { nonexistent: "x" })).toBe(0);
  });

  it("resets and clears series", () => {
    const histogram = new Histogram("reset", {
      help: "reset",
      labelNames: ["k"],
      buckets: [1],
    });
    histogram.observe({ k: "a" }, 0.5);
    histogram.reset({ k: "a" });
    expect(histogram.getCount({ k: "a" })).toBe(0);
    histogram.observe({ k: "b" }, 0.5);
    histogram.clear();
    expect(histogram.seriesCount()).toBe(0);
  });

  it("returns empty bucket counts for unknown series", () => {
    const histogram = createHistogram("empty_buckets", "empty");
    const buckets = histogram.getBucketCounts({ route: "missing" });
    expect(buckets.at(-1)!.count).toBe(0);
  });

  it("collects empty default series when no observations", () => {
    const histogram = createHistogram("empty_collect", "empty");
    const samples = histogram.collect();
    expect(samples).toHaveLength(1);
    expect(samples[0]!.count).toBe(0);
  });

  it("supports object label selectors and labeled helpers", () => {
    const histogram = new Histogram("labeled_obj", {
      help: "labeled",
      labelNames: ["method", "route"],
      buckets: [1, 5],
    });
    const child = histogram.labels({ method: "GET", route: "/api" });
    child.observe(0.25);
    expect(child.getSum()).toBeCloseTo(0.25);
    expect(child.getBucketCounts().length).toBeGreaterThan(0);
    child.reset();
    expect(child.getCount()).toBe(0);

    const positional = histogram.labels("POST", "/ws");
    positional.observe(0.75);
    expect(positional.getCount()).toBe(1);
    expect(positional.equals(child)).toBe(false);
    expect(positional.getLabelSet()).toEqual({ method: "POST", route: "/ws" });
  });

  it("reads default-series helpers before observations", () => {
    const histogram = createHistogram("default_reads", "default reads", { buckets: [1, 5] });
    expect(histogram.getCount()).toBe(0);
    expect(histogram.getSum()).toBe(0);
    expect(histogram.getBucketCounts().at(-1)!.count).toBe(0);
  });

  it("tracks series metadata and default labels", () => {
    const histogram = new Histogram("meta", {
      help: "meta",
      labelNames: ["env"],
      buckets: [1],
    });
    histogram.observe({ env: "dev" }, 0.1);
    expect(histogram.hasSeries({ env: "dev" })).toBe(true);
    expect(histogram.labelSets()).toEqual([{ env: "dev" }]);

    const wrapped = histogram.withDefaultLabels({ env: "prod" });
    wrapped.observe({}, 0.2);
    expect(wrapped.getCount({ env: "prod" })).toBe(1);

    histogram.reset();
    expect(histogram.seriesCount()).toBe(0);
  });
});
