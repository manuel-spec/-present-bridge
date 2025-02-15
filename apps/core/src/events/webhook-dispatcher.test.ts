import { describe, expect, it, vi } from "vitest";
import {
  WebhookDispatcher,
  createWebhookConfig,
  createWebhookDispatcher,
} from "./webhook-dispatcher.js";
import { ServerEventType, WebhookDeliveryMode, createEventId } from "./types.js";

function createEvent() {
  return {
    type: ServerEventType.PEER_JOINED,
    timestamp: new Date().toISOString(),
    eventId: createEventId(),
    source: "test",
    payload: { roomId: "room-a", peerId: "peer-1" },
  };
}

describe("WebhookDispatcher", () => {
  it("registers and unregisters webhooks", () => {
    const dispatcher = createWebhookDispatcher();
    const config = createWebhookConfig({ id: "wh-1", url: "https://example.com/hook" });
    dispatcher.register(config);
    expect(dispatcher.get("wh-1")).toEqual(config);
    expect(dispatcher.unregister("wh-1")).toBe(true);
    expect(dispatcher.list()).toHaveLength(0);
  });

  it("delivers events to matching webhooks", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200, ok: true });
    const dispatcher = new WebhookDispatcher({ fetchFn });
    dispatcher.register(
      createWebhookConfig({
        id: "wh-1",
        url: "https://example.com/hook",
        eventTypes: [ServerEventType.PEER_JOINED],
      }),
    );

    const results = await dispatcher.dispatch(createEvent());
    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries failed deliveries in at_least_once mode", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true });

    const dispatcher = new WebhookDispatcher({
      fetchFn,
      defaultTimeoutMs: 1000,
    });

    dispatcher.register(
      createWebhookConfig({
        id: "wh-1",
        url: "https://example.com/hook",
        maxRetries: 2,
        retryDelayMs: 1,
      }),
    );

    const result = await dispatcher.deliver(
      dispatcher.get("wh-1")!,
      createEvent(),
    );
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("records delivery failures after exhausting retries", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const dispatcher = new WebhookDispatcher({ fetchFn });
    dispatcher.register(
      createWebhookConfig({
        id: "wh-1",
        url: "https://example.com/hook",
        maxRetries: 1,
        retryDelayMs: 1,
      }),
    );

    const results = await dispatcher.dispatch(createEvent());
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toContain("network down");
    expect(dispatcher.getDeliveryHistory()).toHaveLength(1);
  });

  it("signs payloads when secret configured", () => {
    const dispatcher = createWebhookDispatcher();
    const signature = dispatcher.signPayload('{"test":true}', "secret");
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("delivers fire-and-forget webhooks without retries", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 500, ok: false });
    const dispatcher = new WebhookDispatcher({ fetchFn });
    dispatcher.register(
      createWebhookConfig({
        id: "wh-1",
        url: "https://example.com/hook",
        deliveryMode: WebhookDeliveryMode.FIRE_AND_FORGET,
        maxRetries: 5,
      }),
    );

    const result = await dispatcher.deliver(dispatcher.get("wh-1")!, createEvent());
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("includes custom headers and filters delivery history by webhook", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200, ok: true });
    const dispatcher = new WebhookDispatcher({ fetchFn });
    dispatcher.register(
      createWebhookConfig({
        id: "wh-1",
        url: "https://example.com/hook",
        secret: "top-secret",
        headers: { "x-custom": "1" },
      }),
    );

    await dispatcher.dispatch(createEvent());
    const [, init] = fetchFn.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-custom"]).toBe("1");
    expect(headers["x-packet-bridge-signature"]).toBeTruthy();
    expect(dispatcher.getDeliveryHistoryForWebhook("wh-1")).toHaveLength(1);
  });

  it("handles non-error throwables during delivery", async () => {
    const fetchFn = vi.fn().mockRejectedValue("plain failure");
    const dispatcher = new WebhookDispatcher({ fetchFn });
    dispatcher.register(
      createWebhookConfig({
        id: "wh-1",
        url: "https://example.com/hook",
        maxRetries: 0,
        retryDelayMs: 1,
      }),
    );

    const result = await dispatcher.deliver(dispatcher.get("wh-1")!, createEvent());
    expect(result.success).toBe(false);
    expect(result.error).toBe("Webhook delivery failed");
  });

  it("skips disabled or non-matching webhooks", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200, ok: true });
    const dispatcher = new WebhookDispatcher({ fetchFn });
    dispatcher.register(
      createWebhookConfig({
        id: "wh-1",
        url: "https://example.com/hook",
        enabled: false,
      }),
    );
    dispatcher.register(
      createWebhookConfig({
        id: "wh-2",
        url: "https://example.com/other",
        eventTypes: [ServerEventType.ROOM_CREATED],
      }),
    );

    const results = await dispatcher.dispatch(createEvent());
    expect(results).toHaveLength(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
