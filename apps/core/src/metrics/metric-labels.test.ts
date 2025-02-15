import { describe, expect, it } from "vitest";
import { MetricsError } from "./types.js";
import {
  allLabelValuesNonEmpty,
  buildLabelSet,
  deduplicateLabels,
  diffLabelSets,
  escapeLabelValue,
  extractLabelValues,
  hasRequiredLabels,
  formatLabelSet,
  labelCount,
  labelsToQueryString,
  mergeLabelSets,
  normalizeLabelSet,
  queryStringToLabels,
  requireValidLabels,
  sanitizeLabelName,
  sanitizeLabelValue,
  sortedLabelKeys,
  stripEmptyLabelValues,
  validateLabelName,
  validateLabelSet,
  validateLabelValue,
} from "./metric-labels.js";

describe("metric-labels", () => {
  it("validates label names", () => {
    expect(validateLabelName("room_id").valid).toBe(true);
    expect(validateLabelName("").valid).toBe(false);
    expect(validateLabelName("__name__").valid).toBe(false);
    expect(validateLabelName("bad-name").valid).toBe(false);
  });

  it("sanitizes invalid label names", () => {
    expect(sanitizeLabelName("bad-name")).toBe("bad_name");
    expect(sanitizeLabelName("9start")).toBe("_9start");
  });

  it("validates and truncates label values", () => {
    const long = "x".repeat(300);
    const result = validateLabelValue(long);
    expect(result.valid).toBe(true);
    expect(result.sanitized.length).toBe(256);
    expect(result.warning).toBeTruthy();
  });

  it("escapes prometheus label values", () => {
    expect(escapeLabelValue('say "hello"\n')).toBe('say \\"hello\\"\\n');
    expect(escapeLabelValue("path\\to")).toBe("path\\\\to");
  });

  it("formats label sets for prometheus output", () => {
    expect(formatLabelSet({ b: "2", a: "1" })).toBe('{a="1",b="2"}');
    expect(formatLabelSet({})).toBe("");
  });

  it("validates label sets against expected schema", () => {
    const result = validateLabelSet({ room_id: "abc" }, ["room_id"]);
    expect(result.valid).toBe(true);
    expect(result.sanitized).toEqual({ room_id: "abc" });

    const missing = validateLabelSet({}, ["room_id"]);
    expect(missing.valid).toBe(false);
    expect(missing.errors.length).toBeGreaterThan(0);
  });

  it("throws on invalid labels via requireValidLabels", () => {
    expect(() => requireValidLabels({ bad: "x" }, ["room_id"])).toThrow(MetricsError);
    expect(requireValidLabels({ room_id: "r1" }, ["room_id"])).toEqual({ room_id: "r1" });
  });

  it("builds label sets from parallel arrays", () => {
    expect(buildLabelSet(["a", "b"], ["1", "2"])).toEqual({ a: "1", b: "2" });
    expect(() => buildLabelSet(["a"], ["1", "2"])).toThrow(MetricsError);
  });

  it("normalizes and deduplicates labels", () => {
    expect(normalizeLabelSet({ "bad-key": " value "})).toEqual({ bad_key: "value" });
    expect(deduplicateLabels({ room: "a" })).toEqual({ room: "a" });
  });

  it("converts labels to and from query strings", () => {
    const labels = { room_id: "abc", peer_id: "xyz" };
    const query = labelsToQueryString(labels);
    expect(queryStringToLabels(query)).toEqual(labels);
  });

  it("merges multiple label sets", () => {
    expect(mergeLabelSets({ a: "1" }, { b: "2" }, { a: "9" })).toEqual({ a: "9", b: "2" });
  });

  it("strips empty label values", () => {
    expect(stripEmptyLabelValues({ a: "1", b: "" })).toEqual({ a: "1" });
  });

  it("checks label value presence and count", () => {
    expect(allLabelValuesNonEmpty({ a: "1", b: "2" })).toBe(true);
    expect(allLabelValuesNonEmpty({ a: "1", b: "" })).toBe(false);
    expect(labelCount({ a: "1", b: "2" })).toBe(2);
  });

  it("sanitizes label values by trimming", () => {
    expect(sanitizeLabelValue("  hello  ")).toBe("hello");
  });

  it("handles empty and malformed query strings", () => {
    expect(queryStringToLabels("")).toEqual({});
    expect(queryStringToLabels("badsegment")).toEqual({ badsegment: "" });
    expect(queryStringToLabels("room_id=")).toEqual({ room_id: "" });
    expect(queryStringToLabels("=ignored&room_id=abc")).toEqual({ room_id: "abc" });
    expect(queryStringToLabels("room%20id=abc")).toEqual({ room_id: "abc" });
  });

  it("extracts label values in schema order", () => {
    expect(extractLabelValues({ room_id: "a", peer_id: "p" }, ["room_id", "peer_id"])).toEqual([
      "a",
      "p",
    ]);
    expect(extractLabelValues({}, ["missing"])).toEqual([""]);
  });

  it("reports unexpected labels", () => {
    const result = validateLabelSet({ room_id: "a", extra: "b" }, ["room_id"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("Unexpected label"))).toBe(true);
  });

  it("collects label value truncation warnings", () => {
    const long = "x".repeat(300);
    const result = validateLabelSet({ room_id: long });
    expect(result.warnings).toHaveLength(1);
    expect(result.sanitized.room_id?.length).toBe(256);
  });

  it("reports label count mismatches", () => {
    const result = validateLabelSet({ room_id: "a" }, ["room_id", "room_id"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("Label count mismatch"))).toBe(true);
  });

  it("compares and inspects label sets", () => {
    expect(hasRequiredLabels({ room_id: "a" }, ["room_id"])).toBe(true);
    expect(hasRequiredLabels({ room_id: "a" }, ["peer_id"])).toBe(false);
    expect(sortedLabelKeys({ z: "1", a: "2" })).toEqual(["a", "z"]);
    expect(diffLabelSets({ a: "1", b: "2" }, { a: "1", b: "3", c: "4" })).toEqual(["b", "c"]);
  });

  it("normalizes invalid label keys during normalization", () => {
    expect(normalizeLabelSet({ "9bad": "value" })).toEqual({ _9bad: "value" });
  });
});
