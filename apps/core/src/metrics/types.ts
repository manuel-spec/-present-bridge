/**
 * Core type definitions for the packet-bridge metrics subsystem.
 * Aligned with Prometheus metric types and exposition conventions.
 */

/** Supported Prometheus-compatible metric kinds. */
export type MetricType = "counter" | "gauge" | "histogram" | "summary";

/** Immutable label set attached to a metric sample. */
export type LabelSet = Readonly<Record<string, string>>;

/** Options shared by all metric constructors. */
export interface MetricOptions {
  /** Human-readable description exported as HELP text. */
  readonly help: string;
  /** Optional static labels applied to every sample of this metric. */
  readonly labelNames?: readonly string[];
  /** Namespace prefix prepended to the metric name (e.g. `packet_bridge`). */
  readonly namespace?: string;
  /** Subsystem segment inserted between namespace and name. */
  readonly subsystem?: string;
}

/** Fully-qualified metric name after namespace/subsystem resolution. */
export type QualifiedMetricName = string;

/** A single numeric observation with its label dimensions. */
export interface MetricSample {
  readonly name: QualifiedMetricName;
  readonly type: MetricType;
  readonly help: string;
  readonly labels: LabelSet;
  readonly value: number;
  readonly timestampMs?: number;
}

/** Histogram bucket boundary used for cumulative bucket counts. */
export interface HistogramBucket {
  readonly le: number | "+Inf";
  readonly count: number;
}

/** A histogram sample including bucket, sum, and count series. */
export interface HistogramSample {
  readonly name: QualifiedMetricName;
  readonly help: string;
  readonly labels: LabelSet;
  readonly buckets: readonly HistogramBucket[];
  readonly sum: number;
  readonly count: number;
  readonly timestampMs?: number;
}

/** Descriptor used when registering a metric in the registry. */
export interface MetricDescriptor {
  readonly name: string;
  readonly type: MetricType;
  readonly help: string;
  readonly labelNames: readonly string[];
  readonly qualifiedName: QualifiedMetricName;
}

/** Result of validating a batch of label key/value pairs. */
export interface LabelValidationResult {
  readonly valid: boolean;
  readonly sanitized: LabelSet;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Configuration for histogram bucket boundaries. */
export interface HistogramOptions extends MetricOptions {
  /** Upper bounds (less-than-or-equal) for histogram buckets. */
  readonly buckets?: readonly number[];
}

/** Default latency-oriented histogram buckets (seconds). */
export const DEFAULT_LATENCY_BUCKETS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

/** Default size-oriented histogram buckets (bytes). */
export const DEFAULT_SIZE_BUCKETS: readonly number[] = [
  64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304,
] as const;

/** Prometheus metric name character pattern. */
export const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

/** Prometheus label name character pattern. */
export const LABEL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Reserved label names that must not be supplied by callers. */
export const RESERVED_LABEL_NAMES: readonly string[] = ["__name__", "le"] as const;

/** Error thrown when metric registration or collection fails. */
export class MetricsError extends Error {
  readonly code: MetricsErrorCode;

  constructor(code: MetricsErrorCode, message: string) {
    super(message);
    this.name = "MetricsError";
    this.code = code;
  }
}

/** Machine-readable metrics error codes. */
export type MetricsErrorCode =
  | "DUPLICATE_METRIC"
  | "INVALID_METRIC_NAME"
  | "INVALID_LABELS"
  | "UNKNOWN_METRIC"
  | "LABEL_MISMATCH"
  | "NEGATIVE_COUNTER";

/** Builds a fully-qualified metric name from parts. */
export function buildQualifiedName(
  name: string,
  namespace?: string,
  subsystem?: string,
): QualifiedMetricName {
  const segments: string[] = [];
  if (namespace) {
    segments.push(sanitizeMetricNameSegment(namespace));
  }
  if (subsystem) {
    segments.push(sanitizeMetricNameSegment(subsystem));
  }
  segments.push(sanitizeMetricNameSegment(name));
  return segments.join("_");
}

/** Sanitizes a single metric name segment to Prometheus-safe characters. */
export function sanitizeMetricNameSegment(segment: string): string {
  const trimmed = segment.trim();
  if (trimmed.length === 0) {
    return "unnamed";
  }

  let result = trimmed.replace(/[^a-zA-Z0-9_:]/g, "_");
  if (!/^[a-zA-Z_:]/.test(result)) {
    result = `_${result}`;
  }
  return result;
}

/** Validates a raw metric name before registration. */
export function validateMetricName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Metric name must not be empty" };
  }
  if (!METRIC_NAME_PATTERN.test(trimmed)) {
    return {
      valid: false,
      error: `Metric name "${trimmed}" does not match Prometheus naming rules`,
    };
  }
  return { valid: true };
}

/** Compares two label sets for structural equality. */
export function labelsEqual(a: LabelSet, b: LabelSet): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key, index) => key === keysB[index] && a[key] === b[key]);
}

/** Serializes a label set to a stable string key for internal maps. */
export function serializeLabels(labels: LabelSet): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join(",");
}

/** Parses a serialized label key back into a label set. */
export function deserializeLabels(serialized: string): LabelSet {
  if (serialized.length === 0) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const pair of serialized.split(",")) {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    result[key] = value;
  }
  return result;
}

/** Checks whether a label name list matches the expected schema. */
export function assertLabelNames(
  provided: readonly string[],
  expected: readonly string[],
): void {
  const providedSorted = [...provided].sort();
  const expectedSorted = [...expected].sort();
  if (providedSorted.length !== expectedSorted.length) {
    throw new MetricsError(
      "LABEL_MISMATCH",
      `Expected label names [${expectedSorted.join(", ")}] but received [${providedSorted.join(", ")}]`,
    );
  }
  for (let index = 0; index < expectedSorted.length; index += 1) {
    if (providedSorted[index] !== expectedSorted[index]) {
      throw new MetricsError(
        "LABEL_MISMATCH",
        `Expected label names [${expectedSorted.join(", ")}] but received [${providedSorted.join(", ")}]`,
      );
    }
  }
}

/** Creates an empty frozen label set. */
export function emptyLabels(): LabelSet {
  return Object.freeze({});
}

/** Merges base labels with override labels; overrides win on conflict. */
export function mergeLabels(base: LabelSet, overrides: LabelSet): LabelSet {
  return Object.freeze({ ...base, ...overrides });
}

/** Type guard for MetricSample objects. */
export function isMetricSample(value: unknown): value is MetricSample {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const sample = value as MetricSample;
  return (
    typeof sample.name === "string" &&
    typeof sample.type === "string" &&
    typeof sample.help === "string" &&
    typeof sample.value === "number" &&
    typeof sample.labels === "object"
  );
}

/** Type guard for HistogramSample objects. */
export function isHistogramSample(value: unknown): value is HistogramSample {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const sample = value as HistogramSample;
  return (
    typeof sample.name === "string" &&
    typeof sample.help === "string" &&
    typeof sample.sum === "number" &&
    typeof sample.count === "number" &&
    Array.isArray(sample.buckets)
  );
}
