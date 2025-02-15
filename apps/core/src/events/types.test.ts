import { describe, expect, it } from "vitest";
import {
  AuditSeverity,
  DEFAULT_EVENT_SERVICE_CONFIG,
  ServerEventType,
  createAuditId,
  createEventId,
  eventMatchesWebhook,
  isServerEventType,
  severityForEventType,
} from "./types.js";

describe("events/types", () => {
  it("identifies server event types", () => {
    expect(isServerEventType(ServerEventType.PEER_JOINED)).toBe(true);
    expect(isServerEventType("unknown.event")).toBe(false);
  });

  it("creates unique event and audit ids", () => {
    expect(createEventId()).toMatch(/^evt_/);
    expect(createAuditId()).toMatch(/^aud_/);
    expect(createEventId()).not.toBe(createEventId());
  });

  it("matches webhooks by enabled state and event types", () => {
    const event = {
      type: ServerEventType.PEER_JOINED,
      timestamp: new Date().toISOString(),
      eventId: createEventId(),
      source: "test",
      payload: { roomId: "room-a", peerId: "p1" },
    };

    expect(
      eventMatchesWebhook(event, {
        id: "wh-1",
        url: "https://example.com",
        enabled: false,
        eventTypes: [],
        deliveryMode: "at_least_once",
        maxRetries: 1,
        retryDelayMs: 100,
        timeoutMs: 1000,
      }),
    ).toBe(false);

    expect(
      eventMatchesWebhook(event, {
        id: "wh-2",
        url: "https://example.com",
        enabled: true,
        eventTypes: [ServerEventType.PEER_JOINED],
        deliveryMode: "at_least_once",
        maxRetries: 1,
        retryDelayMs: 100,
        timeoutMs: 1000,
      }),
    ).toBe(true);
  });

  it("maps event types to audit severity", () => {
    expect(severityForEventType(ServerEventType.AUTH_FAILURE)).toBe(AuditSeverity.WARN);
    expect(severityForEventType(ServerEventType.PEER_JOINED)).toBe(AuditSeverity.INFO);
  });

  it("exposes default event service config", () => {
    expect(DEFAULT_EVENT_SERVICE_CONFIG.auditCapacity).toBeGreaterThan(0);
    expect(DEFAULT_EVENT_SERVICE_CONFIG.webhooksEnabled).toBe(true);
  });
});
