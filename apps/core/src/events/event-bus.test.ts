import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "./event-bus.js";
import { ServerEventType } from "./types.js";

describe("EventBus", () => {
  it("publishes events to typed subscribers", async () => {
    const bus = createEventBus("test-source");
    const handler = vi.fn();
    bus.subscribe(ServerEventType.PEER_JOINED, handler);

    const event = await bus.publish(ServerEventType.PEER_JOINED, {
      roomId: "room-a",
      peerId: "peer-1",
    });

    expect(event.source).toBe("test-source");
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("delivers wildcard subscriptions", async () => {
    const bus = createEventBus();
    const wildcard = vi.fn();
    bus.subscribe("*", wildcard);

    await bus.publish(ServerEventType.ROOM_CREATED, { roomId: "room-a" });
    expect(wildcard).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes handlers", async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const unsub = bus.subscribe(ServerEventType.PEER_LEFT, handler);
    unsub();

    await bus.publish(ServerEventType.PEER_LEFT, { roomId: "room-a", peerId: "p1" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("subscribeOnce removes handler after first dispatch", async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribeOnce(ServerEventType.PEER_JOINED, handler);

    await bus.publish(ServerEventType.PEER_JOINED, { roomId: "room-a", peerId: "p1" });
    await bus.publish(ServerEventType.PEER_JOINED, { roomId: "room-a", peerId: "p2" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("isolates handler errors", async () => {
    const bus = createEventBus();
    bus.subscribe(ServerEventType.PEER_JOINED, () => {
      throw new Error("handler failed");
    });
    const safe = vi.fn();
    bus.subscribe(ServerEventType.PEER_JOINED, safe);

    await bus.publish(ServerEventType.PEER_JOINED, { roomId: "room-a", peerId: "p1" });
    expect(safe).toHaveBeenCalled();
  });

  it("publishes existing events without rebuilding payload", async () => {
    const bus = createEventBus("existing");
    const handler = vi.fn();
    bus.subscribe(ServerEventType.ROOM_CREATED, handler);

    const event = {
      type: ServerEventType.ROOM_CREATED,
      timestamp: new Date().toISOString(),
      eventId: "evt-1",
      source: "existing",
      payload: { roomId: "room-a" },
    };
    await bus.publishExisting(event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("clears and counts listeners for specific event types", async () => {
    const bus = createEventBus();
    bus.subscribe(ServerEventType.PEER_JOINED, vi.fn());
    bus.subscribe(ServerEventType.PEER_LEFT, vi.fn());

    expect(bus.listenerCount(ServerEventType.PEER_JOINED)).toBe(1);
    bus.clear(ServerEventType.PEER_JOINED);
    expect(bus.listenerCount(ServerEventType.PEER_JOINED)).toBe(0);
    expect(bus.listenerCount()).toBe(1);
  });

  it("tracks stats and supports clear", async () => {
    const bus = createEventBus();
    bus.subscribe(ServerEventType.ROOM_CREATED, vi.fn());
    await bus.publish(ServerEventType.ROOM_CREATED, { roomId: "room-a" });

    const stats = bus.getStats();
    expect(stats.totalPublished).toBe(1);
    expect(stats.subscriberCount).toBeGreaterThan(0);

    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });
});
