import { describe, expect, it, vi } from "vitest";
import { createEventService } from "./event-service.js";
import { createWebhookConfig, createWebhookDispatcher } from "./webhook-dispatcher.js";
import { ServerEventType } from "./types.js";

describe("EventService", () => {
  it("emits events and notifies subscribers", async () => {
    const service = createEventService({ config: { webhooksEnabled: false } });
    const handler = vi.fn();
    service.on(ServerEventType.ROOM_CREATED, handler);

    await service.emitRoomCreated("room-a");
    expect(handler).toHaveBeenCalled();
  });

  it("records audit entries for emitted events", async () => {
    const service = createEventService({ config: { webhooksEnabled: false } });
    await service.emitPeerJoined("room-a", "peer-1", "Alice");

    const audit = service.getRecentAudit();
    expect(audit.some((entry) => entry.action === ServerEventType.PEER_JOINED)).toBe(true);
  });

  it("registers webhooks and dispatches on emit", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200, ok: true });
    const dispatcher = createWebhookDispatcher({ fetchFn });
    const service = createEventService({ webhookDispatcher: dispatcher });

    service.registerWebhook(
      createWebhookConfig({
        id: "wh-1",
        url: "https://example.com/hook",
      }),
    );

    await service.emit(ServerEventType.PEER_LEFT, { roomId: "room-a", peerId: "p1" });
    expect(fetchFn).toHaveBeenCalled();
  });

  it("supports convenience emit helpers", async () => {
    const service = createEventService({ config: { webhooksEnabled: false } });
    await service.emitPeerLeft("room-a", "peer-1");
    await service.emitAuthFailure("bad token", "alice", "room-a");
    await service.emitPolicyViolation("room", "join", { roomId: "room-a" });

    expect(service.queryAudit().length).toBeGreaterThanOrEqual(3);
  });

  it("exposes internal components and closes cleanly", async () => {
    const service = createEventService({ config: { webhooksEnabled: false } });
    expect(service.getBus()).toBeTruthy();
    expect(service.getAuditLog()).toBeTruthy();
    expect(service.getConfig().source).toBeTruthy();

    service.registerWebhook(createWebhookConfig({ id: "wh-1", url: "https://example.com" }));
    service.close();
    expect(service.listWebhooks()).toHaveLength(0);
  });

  it("exposes webhook dispatcher and delivery history", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200, ok: true });
    const dispatcher = createWebhookDispatcher({ fetchFn });
    const service = createEventService({ webhookDispatcher: dispatcher });
    service.registerWebhook(
      createWebhookConfig({ id: "wh-1", url: "https://example.com/hook" }),
    );

    await service.emit(ServerEventType.PEER_JOINED, { roomId: "room-a", peerId: "p1" });
    expect(service.getWebhookDispatcher()).toBe(dispatcher);
    expect(service.getWebhookDeliveryHistory(1)).toHaveLength(1);
  });

  it("supports once subscriptions via bus", async () => {
    const service = createEventService({ config: { webhooksEnabled: false } });
    const handler = vi.fn();
    service.once(ServerEventType.ROOM_CREATED, handler);

    await service.emit(ServerEventType.ROOM_CREATED, { roomId: "room-a" });
    await service.emit(ServerEventType.ROOM_CREATED, { roomId: "room-b" });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
