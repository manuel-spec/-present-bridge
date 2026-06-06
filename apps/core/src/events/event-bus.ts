import {
  type EventBusStats,
  type EventHandler,
  type ServerEvent,
  type ServerEventPayload,
  type ServerEventType,
  type Unsubscribe,
  createEventId,
} from "./types.js";

type HandlerEntry = {
  readonly handler: EventHandler;
  readonly once: boolean;
};

export class EventBus {
  private readonly handlers = new Map<ServerEventType | "*", Set<HandlerEntry>>();
  private totalPublished = 0;
  private readonly defaultSource: string;

  constructor(defaultSource = "bridge-packet-core") {
    this.defaultSource = defaultSource;
    this.handlers.set("*", new Set());
  }

  subscribe<TPayload extends ServerEventPayload>(
    eventType: ServerEventType | "*",
    handler: EventHandler<TPayload>,
  ): Unsubscribe {
    const entry: HandlerEntry = { handler: handler as EventHandler, once: false };
    this.addHandler(eventType, entry);
    return () => this.removeHandler(eventType, entry);
  }

  subscribeOnce<TPayload extends ServerEventPayload>(
    eventType: ServerEventType,
    handler: EventHandler<TPayload>,
  ): Unsubscribe {
    const entry: HandlerEntry = { handler: handler as EventHandler, once: true };
    this.addHandler(eventType, entry);
    return () => this.removeHandler(eventType, entry);
  }

  async publish<TPayload extends ServerEventPayload>(
    type: ServerEventType,
    payload: TPayload,
    source?: string,
  ): Promise<ServerEvent<TPayload>> {
    const event: ServerEvent<TPayload> = Object.freeze({
      type,
      timestamp: new Date().toISOString(),
      eventId: createEventId(),
      source: source ?? this.defaultSource,
      payload,
    });

    this.totalPublished += 1;
    await this.dispatch(event);
    return event;
  }

  async publishExisting<TPayload extends ServerEventPayload>(
    event: ServerEvent<TPayload>,
  ): Promise<void> {
    this.totalPublished += 1;
    await this.dispatch(event);
  }

  clear(eventType?: ServerEventType | "*"): void {
    if (eventType) {
      this.handlers.get(eventType)?.clear();
      return;
    }
    for (const set of this.handlers.values()) {
      set.clear();
    }
  }

  listenerCount(eventType?: ServerEventType | "*"): number {
    if (eventType) {
      return this.handlers.get(eventType)?.size ?? 0;
    }

    let total = 0;
    for (const set of this.handlers.values()) {
      total += set.size;
    }
    return total;
  }

  getStats(): EventBusStats {
    const eventTypes = [...this.handlers.keys()].filter((key) => key !== "*") as ServerEventType[];
    return {
      subscriberCount: this.listenerCount(),
      eventTypes,
      totalPublished: this.totalPublished,
    };
  }

  private addHandler(eventType: ServerEventType | "*", entry: HandlerEntry): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(entry);
  }

  private removeHandler(eventType: ServerEventType | "*", entry: HandlerEntry): void {
    this.handlers.get(eventType)?.delete(entry);
  }

  private async dispatch<TPayload extends ServerEventPayload>(
    event: ServerEvent<TPayload>,
  ): Promise<void> {
    const toInvoke: HandlerEntry[] = [];

    for (const entry of this.handlers.get(event.type) ?? []) {
      toInvoke.push(entry);
    }
    for (const entry of this.handlers.get("*") ?? []) {
      toInvoke.push(entry);
    }

    const toRemove: Array<{ type: ServerEventType | "*"; entry: HandlerEntry }> = [];

    for (const entry of toInvoke) {
      try {
        await entry.handler(event);
      } catch {
        // Handlers must not break dispatch; errors are swallowed intentionally.
      }

      if (entry.once) {
        toRemove.push({ type: event.type, entry });
      }
    }

    for (const { type, entry } of toRemove) {
      this.removeHandler(type, entry);
    }
  }
}

export function createEventBus(source?: string): EventBus {
  return new EventBus(source);
}
