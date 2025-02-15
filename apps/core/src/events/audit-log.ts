import {
  type AuditEntry,
  type AuditLogStats,
  type AuditQuery,
  type AuditSeverity,
  type ServerEvent,
  AuditSeverity as Severities,
  createAuditId,
  severityForEventType,
} from "./types.js";

export interface AuditLogOptions {
  readonly capacity?: number;
}

export class AuditLog {
  private readonly buffer: AuditEntry[] = [];
  private readonly capacity: number;
  private dropped = 0;
  private sequence = 0;

  constructor(options: AuditLogOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? 1000);
  }

  append(entry: Omit<AuditEntry, "id"> & { id?: string }): AuditEntry {
    const record: AuditEntry = Object.freeze({
      id: entry.id ?? createAuditId(),
      timestamp: entry.timestamp,
      severity: entry.severity,
      category: entry.category,
      action: entry.action,
      actor: entry.actor,
      resource: entry.resource,
      message: entry.message,
      metadata: entry.metadata ? Object.freeze({ ...entry.metadata }) : undefined,
      eventId: entry.eventId,
    });

    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
      this.dropped += 1;
    }

    this.buffer.push(record);
    this.sequence += 1;
    return record;
  }

  recordEvent(event: ServerEvent, overrides: Partial<Omit<AuditEntry, "id" | "timestamp" | "eventId">> = {}): AuditEntry {
    const payload = event.payload as Record<string, unknown>;
    return this.append({
      timestamp: event.timestamp,
      severity: overrides.severity ?? severityForEventType(event.type),
      category: overrides.category ?? event.type.split(".")[0] ?? "server",
      action: overrides.action ?? event.type,
      actor: overrides.actor ?? (typeof payload.subject === "string" ? payload.subject : undefined),
      resource: overrides.resource ?? (typeof payload.roomId === "string" ? payload.roomId : undefined),
      message: overrides.message ?? `Event ${event.type}`,
      metadata: overrides.metadata ?? { payload: event.payload },
      eventId: event.eventId,
    });
  }

  query(filters: AuditQuery = {}): AuditEntry[] {
    let results = [...this.buffer];

    if (filters.since) {
      const sinceMs = Date.parse(filters.since);
      results = results.filter((entry) => Date.parse(entry.timestamp) >= sinceMs);
    }

    if (filters.until) {
      const untilMs = Date.parse(filters.until);
      results = results.filter((entry) => Date.parse(entry.timestamp) <= untilMs);
    }

    if (filters.severity) {
      results = results.filter((entry) => entry.severity === filters.severity);
    }

    if (filters.category) {
      results = results.filter((entry) => entry.category === filters.category);
    }

    if (filters.actor) {
      results = results.filter((entry) => entry.actor === filters.actor);
    }

    if (filters.limit !== undefined && filters.limit >= 0) {
      results = results.slice(-filters.limit);
    }

    return results;
  }

  getRecent(limit = 50): AuditEntry[] {
    return this.query({ limit });
  }

  getById(id: string): AuditEntry | undefined {
    return this.buffer.find((entry) => entry.id === id);
  }

  getByEventId(eventId: string): AuditEntry[] {
    return this.buffer.filter((entry) => entry.eventId === eventId);
  }

  count(filters: AuditQuery = {}): number {
    return this.query(filters).length;
  }

  clear(): void {
    this.buffer.length = 0;
  }

  getStats(): AuditLogStats {
    return {
      capacity: this.capacity,
      size: this.buffer.length,
      dropped: this.dropped,
    };
  }

  getSequence(): number {
    return this.sequence;
  }

  toArray(): readonly AuditEntry[] {
    return [...this.buffer];
  }

  filterBySeverity(severity: AuditSeverity): AuditEntry[] {
    return this.buffer.filter((entry) => entry.severity === severity);
  }

  filterByCategory(category: string): AuditEntry[] {
    return this.buffer.filter((entry) => entry.category === category);
  }

  latest(): AuditEntry | undefined {
    return this.buffer[this.buffer.length - 1];
  }

  warn(message: string, details: Partial<Omit<AuditEntry, "id" | "severity" | "message">> = {}): AuditEntry {
    return this.append({
      timestamp: new Date().toISOString(),
      severity: Severities.WARN,
      category: details.category ?? "audit",
      action: details.action ?? "warn",
      message,
      ...details,
    });
  }

  error(message: string, details: Partial<Omit<AuditEntry, "id" | "severity" | "message">> = {}): AuditEntry {
    return this.append({
      timestamp: new Date().toISOString(),
      severity: Severities.ERROR,
      category: details.category ?? "audit",
      action: details.action ?? "error",
      message,
      ...details,
    });
  }
}

export function createAuditLog(capacity?: number): AuditLog {
  return new AuditLog({ capacity });
}
