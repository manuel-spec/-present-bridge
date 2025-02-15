import { describe, expect, it } from "vitest";
import { MetricsError } from "./types.js";
import {
  Counter,
  LabeledCounter,
  counterWithSeries,
  createCounter,
  totalCounterValue,
} from "./counter.js";

describe("Counter", () => {
  it("creates and increments an unlabeled counter", () => {
    const counter = createCounter("requests_total", "Total requests");
    counter.inc();
    counter.inc(5);
    expect(counter.get()).toBe(6);
  });

  it("tracks labeled counter series", () => {
    const counter = new Counter("events_total", {
      help: "Events",
      labelNames: ["type"],
    });
    counter.inc({ type: "join" });
    counter.inc({ type: "join" }, 2);
    counter.inc({ type: "leave" });

    expect(counter.get({ type: "join" })).toBe(3);
    expect(counter.get({ type: "leave" })).toBe(1);
    expect(counter.seriesCount()).toBe(2);
  });

  it("rejects negative increments", () => {
    const counter = createCounter("bad", "bad");
    expect(() => counter.inc(-1)).toThrow(MetricsError);
    expect(() => counter.inc(Infinity)).toThrow(MetricsError);
  });

  it("resets counters", () => {
    const counter = createCounter("resettable", "reset");
    counter.inc(10);
    counter.reset();
    expect(counter.get()).toBe(0);
  });

  it("collects samples including zero default", () => {
    const counter = createCounter("empty", "empty");
    const samples = counter.collect();
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(0);
    expect(samples[0]!.type).toBe("counter");
  });

  it("supports labeled child counters", () => {
    const counter = new Counter("labeled", { help: "labeled", labelNames: ["room"] });
    const child = counter.labels("room-a");
    child.inc(3);
    expect(child.get()).toBe(3);
    expect(child).toBeInstanceOf(LabeledCounter);
  });

  it("creates counter with pre-defined series", () => {
    const counter = counterWithSeries(
      "preseeded",
      { help: "preseeded", labelNames: ["x"] },
      [{ x: "a" }, { x: "b" }],
    );
    expect(counter.seriesCount()).toBe(2);
    expect(counter.get({ x: "a" })).toBe(0);
  });

  it("sums all series via totalCounterValue", () => {
    const counter = new Counter("sum", { help: "sum", labelNames: ["k"] });
    counter.inc({ k: "a" }, 2);
    counter.inc({ k: "b" }, 3);
    expect(totalCounterValue(counter)).toBe(5);
  });

  it("clears all series", () => {
    const counter = createCounter("clearable", "clear");
    counter.inc(5);
    counter.clear();
    expect(counter.seriesCount()).toBe(0);
  });

  it("rejects invalid metric names", () => {
    expect(() => new Counter("", { help: "bad" })).toThrow(MetricsError);
  });

  it("supports object label selectors and labeled helpers", () => {
    const counter = new Counter("labeled_obj", { help: "labeled", labelNames: ["room"] });
    const child = counter.labels({ room: "a" });
    child.inc(2);
    expect(child.get()).toBe(2);
    child.reset();
    expect(child.get()).toBe(0);

    const positional = counter.labels("b");
    positional.inc();
    expect(positional.equals(child)).toBe(false);
    expect(positional.getLabelSet()).toEqual({ room: "b" });
  });

  it("tracks series metadata and default labels", () => {
    const counter = new Counter("meta", { help: "meta", labelNames: ["env"] });
    counter.inc({ env: "dev" }, 4);
    expect(counter.hasSeries({ env: "dev" })).toBe(true);
    expect(counter.labelSets()).toEqual([{ env: "dev" }]);
    counter.validateLabels({ env: "dev" });

    const wrapped = counter.withDefaultLabels({ env: "prod" });
    wrapped.inc({}, 2);
    expect(wrapped.get({ env: "prod" })).toBe(2);

    counter.reset({ env: "dev" });
    expect(counter.get({ env: "dev" })).toBe(0);
  });

  it("resets a single series without error when missing", () => {
    const counter = createCounter("single_reset", "single");
    counter.reset({ missing: "x" });
    expect(counter.get({ missing: "x" })).toBe(0);
  });
});
