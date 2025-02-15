import {
  LABEL_NAME_PATTERN,
  MetricsError,
  RESERVED_LABEL_NAMES,
  type LabelSet,
  type LabelValidationResult,
} from "./types.js";

/** Maximum allowed length for a label name. */
export const MAX_LABEL_NAME_LENGTH = 128;

/** Maximum allowed length for a label value. */
export const MAX_LABEL_VALUE_LENGTH = 256;

/** Characters that must be escaped in Prometheus exposition format. */
export const PROMETHEUS_ESCAPE_CHARS = /\\|\n|"/g;

/** Replacement map for Prometheus string escaping. */
export const PROMETHEUS_ESCAPE_REPLACEMENTS: Record<string, string> = {
  "\\": "\\\\",
  "\n": "\\n",
  '"': '\\"',
};

/** Validates and sanitizes a single label name. */
export function validateLabelName(name: string): { valid: boolean; sanitized: string; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, sanitized: "", error: "Label name must not be empty" };
  }
  if (trimmed.length > MAX_LABEL_NAME_LENGTH) {
    return {
      valid: false,
      sanitized: trimmed.slice(0, MAX_LABEL_NAME_LENGTH),
      error: `Label name exceeds maximum length of ${MAX_LABEL_NAME_LENGTH}`,
    };
  }
  if (RESERVED_LABEL_NAMES.includes(trimmed)) {
    return {
      valid: false,
      sanitized: trimmed,
      error: `Label name "${trimmed}" is reserved`,
    };
  }
  if (!LABEL_NAME_PATTERN.test(trimmed)) {
    const sanitized = sanitizeLabelName(trimmed);
    return {
      valid: false,
      sanitized,
      error: `Label name "${trimmed}" does not match Prometheus naming rules`,
    };
  }
  return { valid: true, sanitized: trimmed };
}

/** Validates and sanitizes a single label value. */
export function validateLabelValue(value: string): { valid: boolean; sanitized: string; warning?: string } {
  if (value.length > MAX_LABEL_VALUE_LENGTH) {
    return {
      valid: true,
      sanitized: value.slice(0, MAX_LABEL_VALUE_LENGTH),
      warning: `Label value truncated to ${MAX_LABEL_VALUE_LENGTH} characters`,
    };
  }
  return { valid: true, sanitized: value };
}

/** Sanitizes a label name to Prometheus-safe characters. */
export function sanitizeLabelName(name: string): string {
  let result = name.trim().replace(/[^a-zA-Z0-9_]/g, "_");
  if (result.length === 0) {
    result = "label";
  }
  if (!/^[a-zA-Z_]/.test(result)) {
    result = `_${result}`;
  }
  if (result.length > MAX_LABEL_NAME_LENGTH) {
    result = result.slice(0, MAX_LABEL_NAME_LENGTH);
  }
  return result;
}

/** Sanitizes a label value by trimming and truncating. */
export function sanitizeLabelValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > MAX_LABEL_VALUE_LENGTH) {
    return trimmed.slice(0, MAX_LABEL_VALUE_LENGTH);
  }
  return trimmed;
}

/** Escapes a label value for Prometheus text exposition format. */
export function escapeLabelValue(value: string): string {
  return value.replace(PROMETHEUS_ESCAPE_CHARS, (char) => PROMETHEUS_ESCAPE_REPLACEMENTS[char] ?? char);
}

/** Formats a label set as `{key="value",...}` for Prometheus output. */
export function formatLabelSet(labels: LabelSet): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) {
    return "";
  }
  const pairs = keys.map((key) => `${key}="${escapeLabelValue(labels[key] ?? "")}"`);
  return `{${pairs.join(",")}}`;
}

/** Validates an entire label set against an expected label name schema. */
export function validateLabelSet(
  labels: Record<string, string>,
  expectedLabelNames?: readonly string[],
): LabelValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sanitized: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(labels)) {
    const nameResult = validateLabelName(rawKey);
    if (!nameResult.valid) {
      errors.push(nameResult.error ?? `Invalid label name: ${rawKey}`);
    }
    const valueResult = validateLabelValue(String(rawValue));
    if (valueResult.warning) {
      warnings.push(valueResult.warning);
    }
    sanitized[nameResult.sanitized] = valueResult.sanitized;
  }

  if (expectedLabelNames) {
    const provided = Object.keys(sanitized).sort();
    const expected = [...expectedLabelNames].sort();

    for (const name of expected) {
      if (!(name in sanitized)) {
        errors.push(`Missing required label: ${name}`);
      }
    }

    for (const name of provided) {
      if (!expected.includes(name)) {
        errors.push(`Unexpected label: ${name}`);
      }
    }

    if (provided.length !== expected.length && errors.length === 0) {
      errors.push(
        `Label count mismatch: expected ${expected.length} labels [${expected.join(", ")}]`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    sanitized: Object.freeze(sanitized),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
  };
}

/** Strictly validates labels and throws MetricsError on failure. */
export function requireValidLabels(
  labels: Record<string, string>,
  expectedLabelNames?: readonly string[],
): LabelSet {
  const result = validateLabelSet(labels, expectedLabelNames);
  if (!result.valid) {
    throw new MetricsError("INVALID_LABELS", result.errors.join("; "));
  }
  return result.sanitized;
}

/** Extracts label values in schema order from a label set. */
export function extractLabelValues(labels: LabelSet, labelNames: readonly string[]): string[] {
  return labelNames.map((name) => labels[name] ?? "");
}

/** Builds a label set from parallel name/value arrays. */
export function buildLabelSet(
  labelNames: readonly string[],
  values: readonly string[],
): LabelSet {
  if (labelNames.length !== values.length) {
    throw new MetricsError(
      "INVALID_LABELS",
      `Label name count (${labelNames.length}) does not match value count (${values.length})`,
    );
  }

  const raw: Record<string, string> = {};
  for (let index = 0; index < labelNames.length; index += 1) {
    raw[labelNames[index]!] = values[index]!;
  }
  return requireValidLabels(raw, labelNames);
}

/** Removes duplicate label keys by keeping the last occurrence. */
export function deduplicateLabels(labels: Record<string, string>): LabelSet {
  const result = validateLabelSet(labels);
  return result.sanitized;
}

/** Checks whether a label set contains all required label names. */
export function hasRequiredLabels(labels: LabelSet, required: readonly string[]): boolean {
  return required.every((name) => name in labels);
}

/** Returns label names present in a set sorted alphabetically. */
export function sortedLabelKeys(labels: LabelSet): string[] {
  return Object.keys(labels).sort();
}

/** Compares two label sets and returns differing keys. */
export function diffLabelSets(a: LabelSet, b: LabelSet): string[] {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const differing: string[] = [];
  for (const key of allKeys) {
    if (a[key] !== b[key]) {
      differing.push(key);
    }
  }
  return differing.sort();
}

/** Strips empty-string label values from a label set. */
export function stripEmptyLabelValues(labels: LabelSet): LabelSet {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value.length > 0) {
      result[key] = value;
    }
  }
  return Object.freeze(result);
}

/** Normalizes a label set by sanitizing all keys and values. */
export function normalizeLabelSet(labels: Record<string, string>): LabelSet {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    const nameResult = validateLabelName(key);
    const sanitizedKey = nameResult.valid ? key.trim() : nameResult.sanitized;
    normalized[sanitizedKey] = sanitizeLabelValue(String(value));
  }
  return Object.freeze(normalized);
}

/** Formats labels as a query-style string `key=value&...`. */
export function labelsToQueryString(labels: LabelSet): string {
  return sortedLabelKeys(labels)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(labels[key] ?? "")}`)
    .join("&");
}

/** Parses a query-style label string into a label set. */
export function queryStringToLabels(query: string): LabelSet {
  if (query.length === 0) {
    return Object.freeze({});
  }
  const raw: Record<string, string> = {};
  for (const segment of query.split("&")) {
    const [encodedKey, encodedValue] = segment.split("=");
    if (!encodedKey) {
      continue;
    }
    const key = decodeURIComponent(encodedKey);
    const value = encodedValue !== undefined ? decodeURIComponent(encodedValue) : "";
    raw[key] = value;
  }
  return normalizeLabelSet(raw);
}

/** Merges multiple label sets left-to-right; later sets override earlier ones. */
export function mergeLabelSets(...sets: readonly LabelSet[]): LabelSet {
  const merged: Record<string, string> = {};
  for (const set of sets) {
    Object.assign(merged, set);
  }
  return normalizeLabelSet(merged);
}

/** Returns true when every label value is a non-empty string. */
export function allLabelValuesNonEmpty(labels: LabelSet): boolean {
  return Object.values(labels).every((value) => value.length > 0);
}

/** Counts the number of labels in a label set. */
export function labelCount(labels: LabelSet): number {
  return Object.keys(labels).length;
}
