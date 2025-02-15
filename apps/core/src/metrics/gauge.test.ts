import { describe, expect, it, vi } from "vitest";
import { MetricsError } from "./types.js";
import {
  Gauge,
  LabeledGauge,
  createGauge,
  maxGaugeValue,
  minGaugeValue,
  totalGaugeValue,
} from "./gauge.js";

describe("Gauge", () => {
  it("rejects invalid gauge names at construction", () => {
    expect(() => new Gauge("invalid-name", { help: "bad" })).toThrow(MetricsError);
  });

  it("sets and gets gauge values", () => {
    const gauge = createGauge("temperature", "Temperature");
    gauge.set(42);
    expect(gauge.get()).toBe(42);
    expect(gauge.name).toBe("temperature");
  });

  it("increments and decrements", () => {
    const gauge = createGauge("connections", "Connections");
    gauge.set(10);
    gauge.inc(3);
    gauge.dec(2);
    expect(gauge.get()).toBe(11);
  });

  it("tracks labeled gauge series", () => {
    const gauge = new Gauge("room_peers", {
      help: "Peers per room",
      labelNames: ["room_id"],
    });
    gauge.set({ room_id: "a" }, 3);
    gauge.inc({ room_id: "a" });
    gauge.set({ room_id: "b" }, 1);

    expect(gauge.get({ room_id: "a" })).toBe(4);
    expect(gauge.get({ room_id: "b" })).toBe(1);
  });

  it("rejects non-finite values", () => {
    const gauge = createGauge("finite", "finite");
    expect(() => gauge.set(NaN)).toThrow(MetricsError);
    expect(() => gauge.set(Infinity)).toThrow(MetricsError);
  });

  it("collects callback-derived samples", () => {
    const gauge = createGauge("dynamic", "dynamic");
    const callback = vi.fn().mockReturnValue(99);
    gauge.addCallback(callback);
    const samples = gauge.collect();
    expect(samples.some((s) => s.value === 99)).toBe(true);
    gauge.removeCallback(callback);
  });

  it("supports labeled child gauges", () => {
    const gauge = new Gauge("labeled", { help: "labeled", labelNames: ["k"] });
    const child = gauge.labels("v");
    child.set(7);
    expect(child.get()).toBe(7);
    expect(child).toBeInstanceOf(LabeledGauge);
  });

  it("supports label-object inc and dec defaults", () => {
    const gauge = new Gauge("labeled_ops", { help: "ops", labelNames: ["k"] });
    gauge.inc({ k: "a" });
    gauge.dec({ k: "a" });
    expect(gauge.get({ k: "a" })).toBe(0);
  });

  it("compares equal labeled gauge views", () => {
    const gauge = new Gauge("equals", { help: "equals", labelNames: ["k"] });
    const a = gauge.labels("v");
    const b = gauge.labels("v");
    expect(a.equals(b)).toBe(true);
    expect(maxGaugeValue(gauge)).toBe(0);
    gauge.set({ k: "v" }, 9);
    expect(maxGaugeValue(gauge)).toBe(9);
    expect(minGaugeValue(gauge)).toBe(9);
  });

  it("aggregates gauge values", () => {
    const gauge = new Gauge("agg", { help: "agg", labelNames: ["x"] });
    gauge.set({ x: "a" }, 2);
    gauge.set({ x: "b" }, 8);
    expect(totalGaugeValue(gauge)).toBe(10);
    expect(maxGaugeValue(gauge)).toBe(8);
    expect(minGaugeValue(gauge)).toBe(2);
  });

  it("resets gauge values", () => {
    const gauge = createGauge("reset", "reset");
    gauge.set(5);
    gauge.reset();
    expect(gauge.get()).toBe(0);
  });

  it("clears cells and callbacks", () => {
    const gauge = createGauge("clear", "clear");
    gauge.set(1);
    gauge.addCallback(() => 2);
    gauge.clear();
    expect(gauge.seriesCount()).toBe(0);
  });

  it("collects zero default sample when empty", () => {
    const gauge = createGauge("empty_collect", "empty");
    const samples = gauge.collect();
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(0);
  });

  it("supports object label selectors and labeled helpers", () => {
    const gauge = new Gauge("labeled_obj", { help: "labeled", labelNames: ["region"] });
    const child = gauge.labels({ region: "us" });
    child.set(4);
    child.inc(2);
    child.dec(1);
    expect(child.get()).toBe(5);
    child.reset();
    expect(child.get()).toBe(0);

    const positional = gauge.labels("eu");
    positional.set(9);
    expect(positional.equals(child)).toBe(false);
    expect(positional.getLabelSet()).toEqual({ region: "eu" });
  });

  it("tracks series metadata and default labels", () => {
    const gauge = new Gauge("meta", { help: "meta", labelNames: ["env"] });
    gauge.set({ env: "dev" }, 3);
    expect(gauge.hasSeries({ env: "dev" })).toBe(true);
    expect(gauge.labelSets()).toEqual([{ env: "dev" }]);

    const wrapped = gauge.withDefaultLabels({ env: "prod" });
    wrapped.set({}, 7);
    expect(wrapped.get({ env: "prod" })).toBe(7);

    gauge.reset({ env: "dev" });
    expect(gauge.get({ env: "dev" })).toBe(0);
  });

  it("returns zero for empty gauge aggregations", () => {
    const gauge = createGauge("empty_agg", "empty");
    expect(maxGaugeValue(gauge)).toBe(0);
    expect(minGaugeValue(gauge)).toBe(0);
  });

  it("wraps gauges with default labels", () => {
    const gauge = new Gauge("wrapped", { help: "wrapped", labelNames: ["env"] });
    const wrapped = gauge.withDefaultLabels({ env: "prod" });
    wrapped.set({}, 12);
    expect(wrapped.get({ env: "prod" })).toBe(12);
  });

  it("ignores removing unknown callbacks", () => {
    const gauge = createGauge("callbacks", "callbacks");
    const callback = () => 1;
    gauge.removeCallback(callback);
    gauge.addCallback(callback);
    gauge.removeCallback(callback);
    expect(gauge.collect()).toHaveLength(1);
  });
});
