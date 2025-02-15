import { describe, expect, it } from "vitest";
import { Counter } from "./counter.js";
import { Gauge } from "./gauge.js";
import { Histogram } from "./histogram.js";
import { MetricsError } from "./types.js";
import {
  MetricRegistry,
  createApplicationRegistry,
  getDefaultRegistry,
  resetDefaultRegistry,
  setDefaultRegistry,
} from "./registry.js";

describe("MetricRegistry", () => {
  it("registers and retrieves metrics", () => {
    const registry = new MetricRegistry();
    const counter = new Counter("requests", { help: "requests" });
    registry.registerCounter(counter);

    expect(registry.getCounter("requests")).toBe(counter);
    expect(registry.has("requests")).toBe(true);
    expect(registry.size()).toBe(1);
  });

  it("returns existing metric on duplicate registration", () => {
    const registry = new MetricRegistry();
    const counterA = new Counter("dup", { help: "dup" });
    const counterB = new Counter("dup", { help: "dup" });
    registry.registerCounter(counterA);
    expect(registry.registerCounter(counterB)).toBe(counterA);
  });

  it("throws on duplicate registration in strict mode", () => {
    const registry = new MetricRegistry({ strictMode: true });
    registry.registerCounter(new Counter("strict", { help: "strict" }));
    expect(() =>
      registry.registerCounter(new Counter("strict", { help: "strict" })),
    ).toThrow(MetricsError);
  });

  it("rejects conflicting metric types for same name", () => {
    const registry = new MetricRegistry();
    registry.registerCounter(new Counter("conflict", { help: "c" }));
    expect(() => registry.registerGauge(new Gauge("conflict", { help: "g" }))).toThrow(
      MetricsError,
    );
  });

  it("collects samples from all registered metrics", () => {
    const registry = new MetricRegistry();
    const counter = new Counter("c", { help: "c" });
    counter.inc(2);
    const gauge = new Gauge("g", { help: "g" });
    gauge.set(5);
    const histogram = new Histogram("h", { help: "h", buckets: [1] });
    histogram.observe(0.5);

    registry.registerCounter(counter);
    registry.registerGauge(gauge);
    registry.registerHistogram(histogram);

    const snapshot = registry.collect();
    expect(snapshot.metricCount).toBe(3);
    expect(snapshot.samples.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.histograms).toHaveLength(1);
  });

  it("unregisters metrics", () => {
    const registry = new MetricRegistry();
    registry.registerGauge(new Gauge("removable", { help: "r" }));
    expect(registry.unregister("removable")).toBe(true);
    expect(registry.unregister("missing")).toBe(false);
    expect(registry.size()).toBe(0);
  });

  it("lists descriptors by type", () => {
    const registry = new MetricRegistry();
    registry.registerCounter(new Counter("a", { help: "a" }));
    registry.registerGauge(new Gauge("b", { help: "b" }));
    expect(registry.listByType("counter")).toHaveLength(1);
    expect(registry.listDescriptors()).toHaveLength(2);
  });

  it("resets all metric values", () => {
    const registry = new MetricRegistry();
    const counter = new Counter("r", { help: "r" });
    counter.inc(5);
    registry.registerCounter(counter);
    registry.resetAll();
    expect(counter.get()).toBe(0);
  });

  it("merges registries", () => {
    const a = new MetricRegistry();
    const b = new MetricRegistry();
    b.registerGauge(new Gauge("merged", { help: "m" }));
    b.registerHistogram(new Histogram("merged_hist", { help: "h", buckets: [1] }));
    a.merge(b);
    expect(a.has("merged")).toBe(true);
    expect(a.getHistogram("merged_hist")).toBeTruthy();
  });

  it("manages default registry singleton", () => {
    const custom = new MetricRegistry();
    setDefaultRegistry(custom);
    expect(getDefaultRegistry()).toBe(custom);
    const fresh = resetDefaultRegistry();
    expect(fresh).not.toBe(custom);
  });

  it("qualifies invalid lookup names without underscores", () => {
    const registry = new MetricRegistry({ defaultNamespace: "app" });
    registry.registerCounter(new Counter("requests_total", { help: "requests", namespace: "app" }));
    expect(registry.getCounter("bad-name")).toBeUndefined();
    expect(registry.has("bad-name")).toBe(false);
  });

  it("rejects completely invalid metric names", () => {
    const registry = new MetricRegistry();
    expect(() => registry.registerCounter(new Counter("", { help: "bad" }))).toThrow(MetricsError);
  });

  it("creates application registry with namespace", () => {
    const registry = createApplicationRegistry();
    expect(registry).toBeInstanceOf(MetricRegistry);
  });
});
