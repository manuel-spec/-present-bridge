import { formatLabelSet, sortedLabelKeys } from "./metric-labels.js";
import type { RegistrySnapshot } from "./registry.js";
import type { HistogramSample, MetricSample } from "./types.js";

/** Options controlling Prometheus text exposition output. */
export interface PrometheusFormatOptions {
  /** Include HELP comments for each metric. */
  readonly includeHelp?: boolean;
  /** Include TYPE comments for each metric. */
  readonly includeType?: boolean;
  /** Include millisecond timestamps on each sample line. */
  readonly includeTimestamp?: boolean;
  /** Prefix all output lines (e.g. for debugging). */
  readonly linePrefix?: string;
  /** Sort metrics alphabetically by name. */
  readonly sortMetrics?: boolean;
}

const DEFAULT_FORMAT_OPTIONS: Required<PrometheusFormatOptions> = {
  includeHelp: true,
  includeType: true,
  includeTimestamp: false,
  linePrefix: "",
  sortMetrics: true,
};

/** Formats a registry snapshot as Prometheus text exposition. */
export function formatRegistrySnapshot(
  snapshot: RegistrySnapshot,
  options: PrometheusFormatOptions = {},
): string {
  const resolved = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  const lines: string[] = [];
  const grouped = groupSamplesByName(snapshot.samples);

  const metricNames = resolved.sortMetrics
    ? [...grouped.keys()].sort()
    : [...grouped.keys()];

  for (const name of metricNames) {
    const samples = grouped.get(name)!;
    appendMetricBlock(lines, samples, resolved);
  }

  for (const histogram of snapshot.histograms) {
    appendHistogramBlock(lines, histogram, resolved);
  }

  if (lines.length === 0) {
    return "";
  }

  return `${lines.join("\n")}\n`;
}

/** Formats a single metric sample line. */
export function formatSampleLine(sample: MetricSample, options: PrometheusFormatOptions = {}): string {
  const resolved = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  const labelText = formatLabelSet(sample.labels);
  const value = formatMetricValue(sample.value);
  const timestamp = resolved.includeTimestamp && sample.timestampMs
    ? ` ${sample.timestampMs}`
    : "";
  return `${resolved.linePrefix}${sample.name}${labelText} ${value}${timestamp}`;
}

/** Formats HELP and TYPE header lines for a metric. */
export function formatMetricHeaders(
  name: string,
  type: string,
  help: string,
  options: PrometheusFormatOptions = {},
): string[] {
  const resolved = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  const lines: string[] = [];
  if (resolved.includeHelp) {
    lines.push(`${resolved.linePrefix}# HELP ${name} ${escapeHelpText(help)}`);
  }
  if (resolved.includeType) {
    lines.push(`${resolved.linePrefix}# TYPE ${name} ${type}`);
  }
  return lines;
}

/** Formats a complete histogram metric block. */
export function formatHistogram(histogram: HistogramSample, options: PrometheusFormatOptions = {}): string {
  const resolved = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  const lines: string[] = [];
  appendHistogramBlock(lines, histogram, resolved);
  return lines.join("\n");
}

/** Formats multiple metric samples sharing the same name. */
export function formatMetricSamples(samples: MetricSample[], options: PrometheusFormatOptions = {}): string {
  if (samples.length === 0) {
    return "";
  }
  const resolved = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  const lines: string[] = [];
  appendMetricBlock(lines, samples, resolved);
  return lines.join("\n");
}

/** Escapes HELP text per Prometheus exposition rules. */
export function escapeHelpText(help: string): string {
  return help.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/** Formats a numeric metric value avoiding scientific notation. */
export function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "NaN";
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toPrecision(12)));
}

/** Groups samples by metric name for ordered output. */
export function groupSamplesByName(samples: readonly MetricSample[]): Map<string, MetricSample[]> {
  const grouped = new Map<string, MetricSample[]>();
  for (const sample of samples) {
    const existing = grouped.get(sample.name);
    if (existing) {
      existing.push(sample);
    } else {
      grouped.set(sample.name, [sample]);
    }
  }
  for (const [, group] of grouped) {
    group.sort((a, b) => compareLabelSets(a.labels, b.labels));
  }
  return grouped;
}

/** Compares two label sets for deterministic sort order. */
export function compareLabelSets(a: Record<string, string>, b: Record<string, string>): number {
  const keysA = sortedLabelKeys(a);
  const keysB = sortedLabelKeys(b);
  const maxLength = Math.max(keysA.length, keysB.length);
  for (let index = 0; index < maxLength; index += 1) {
    const keyA = keysA[index] ?? "";
    const keyB = keysB[index] ?? "";
    if (keyA !== keyB) {
      return keyA.localeCompare(keyB);
    }
    const valueCompare = (a[keyA] ?? "").localeCompare(b[keyB] ?? "");
    if (valueCompare !== 0) {
      return valueCompare;
    }
  }
  return 0;
}

/** Validates that formatted output lines are well-formed. */
export function validateFormattedOutput(output: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const lines = output.split("\n").filter((line) => line.length > 0);

  for (const line of lines) {
    if (line.startsWith("#")) {
      if (!/^# (HELP|TYPE) /.test(line)) {
        errors.push(`Invalid comment line: ${line}`);
      }
      continue;
    }
    if (!/^[^\s{]+(\{[^}]*\})? [-+]?[0-9.eE]+/.test(line)) {
      errors.push(`Invalid sample line: ${line}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Estimates the byte size of formatted output. */
export function estimateOutputSize(snapshot: RegistrySnapshot): number {
  let size = 0;
  for (const sample of snapshot.samples) {
    size += sample.name.length + 32;
    size += Object.keys(sample.labels).length * 16;
  }
  for (const histogram of snapshot.histograms) {
    size += histogram.name.length + histogram.buckets.length * 24;
  }
  return size;
}

function appendMetricBlock(
  lines: string[],
  samples: MetricSample[],
  options: Required<PrometheusFormatOptions>,
): void {
  const first = samples[0]!;
  lines.push(...formatMetricHeaders(first.name, first.type, first.help, options));
  for (const sample of samples) {
    lines.push(formatSampleLine(sample, options));
  }
}

function appendHistogramBlock(
  lines: string[],
  histogram: HistogramSample,
  options: Required<PrometheusFormatOptions>,
): void {
  lines.push(...formatMetricHeaders(histogram.name, "histogram", histogram.help, options));

  for (const bucket of histogram.buckets) {
    const leLabel = formatLabelSet({ ...histogram.labels, le: String(bucket.le) });
    const timestamp = options.includeTimestamp && histogram.timestampMs
      ? ` ${histogram.timestampMs}`
      : "";
    lines.push(`${options.linePrefix}${histogram.name}_bucket${leLabel} ${formatMetricValue(bucket.count)}${timestamp}`);
  }

  const baseLabels = formatLabelSet(histogram.labels);
  const timestamp = options.includeTimestamp && histogram.timestampMs
    ? ` ${histogram.timestampMs}`
    : "";
  lines.push(`${options.linePrefix}${histogram.name}_sum${baseLabels} ${formatMetricValue(histogram.sum)}${timestamp}`);
  lines.push(`${options.linePrefix}${histogram.name}_count${baseLabels} ${formatMetricValue(histogram.count)}${timestamp}`);
}

/** Creates a text/plain content-type header value for Prometheus scraping. */
export function prometheusContentType(): string {
  return "text/plain; version=0.0.4; charset=utf-8";
}

/** Formats a minimal health-check metric response. */
export function formatHealthMetric(up: boolean): string {
  return [
    "# HELP packet_bridge_up Server is accepting connections",
    "# TYPE packet_bridge_up gauge",
    `packet_bridge_up ${up ? 1 : 0}`,
    "",
  ].join("\n");
}
