import { describe, expect, it } from "vitest";
import { AuditSeverity, ServerEventType, createEventId } from "./types.js";
import { createAuditLog } from "./audit-log.js";

describe("AuditLog", () => {
  it("appends entries and enforces ring buffer capacity", () => {
    const log = createAuditLog(3);
    for (let i = 0; i < 5; i += 1) {
      log.append({
        timestamp: new Date().toISOString(),
        severity: AuditSeverity.INFO,
        category: "test",
        action: `action-${i}`,
        message: `message-${i}`,
      });
    }

    const stats = log.getStats();
    expect(stats.size).toBe(3);
    expect(stats.dropped).toBe(2);
    expect(log.getRecent(10)[0]?.action).toBe("action-2");
  });

  it("records server events with derived fields", () => {
    const log = createAuditLog();
    const event = {
      type: ServerEventType.PEER_JOINED,
      timestamp: new Date().toISOString(),
      eventId: createEventId(),
      source: "test",
      payload: { roomId: "room-a", peerId: "peer-1", subject: "alice" },
    };

    const entry = log.recordEvent(event);
    expect(entry.eventId).toBe(event.eventId);
    expect(entry.category).toBe("peer");
    expect(entry.resource).toBe("room-a");
  });

  it("queries by severity, category, actor, and time range", () => {
    const log = createAuditLog(100);
    const now = Date.now();
    log.append({
      timestamp: new Date(now - 5000).toISOString(),
      severity: AuditSeverity.WARN,
      category: "auth",
      action: "auth.failure",
      message: "failed",
      actor: "alice",
    });
    log.append({
      timestamp: new Date(now).toISOString(),
      severity: AuditSeverity.INFO,
      category: "room",
      action: "room.created",
      message: "created",
      actor: "bob",
    });

    expect(log.query({ severity: AuditSeverity.WARN })).toHaveLength(1);
    expect(log.query({ category: "room" })).toHaveLength(1);
    expect(log.query({ actor: "alice" })).toHaveLength(1);
    expect(log.query({ since: new Date(now - 1000).toISOString() })).toHaveLength(1);
    expect(log.query({ until: new Date(now - 1000).toISOString() })).toHaveLength(1);
    expect(log.count()).toBe(2);
  });

  it("finds entries by id and event id", () => {
    const log = createAuditLog();
    const entry = log.warn("something happened", { category: "test" });
    expect(log.getById(entry.id)).toEqual(entry);
    expect(log.getByEventId("missing")).toEqual([]);
  });

  it("supports filter helpers and latest", () => {
    const log = createAuditLog();
    log.error("error one", { category: "system" });
    log.append({
      timestamp: new Date().toISOString(),
      severity: AuditSeverity.INFO,
      category: "system",
      action: "info",
      message: "info one",
    });

    expect(log.filterBySeverity(AuditSeverity.ERROR)).toHaveLength(1);
    expect(log.filterByCategory("system")).toHaveLength(2);
    expect(log.latest()?.message).toBe("info one");
    expect(log.getSequence()).toBe(2);
  });

  it("clears all entries", () => {
    const log = createAuditLog();
    log.warn("test");
    log.clear();
    expect(log.toArray()).toHaveLength(0);
  });
});
