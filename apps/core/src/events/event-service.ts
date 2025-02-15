import {
  type AuditEntry,
  type AuditQuery,
  type EventHandler,
  type EventServiceConfig,
  type ServerEvent,
  type ServerEventPayload,
  type ServerEventType,
  type Unsubscribe,
  type WebhookConfig,
  type WebhookDeliveryResult,
  DEFAULT_EVENT_SERVICE_CONFIG,
  ServerEventType as EventTypes,
} from "./types.js";
import { EventBus, createEventBus } from "./event-bus.js";
import { AuditLog, createAuditLog } from "./audit-log.js";
import { WebhookDispatcher, createWebhookDispatcher } from "./webhook-dispatcher.js";

export interface EventServiceOptions {
  readonly config?: Partial<EventServiceConfig>;
  readonly bus?: EventBus;
  readonly auditLog?: AuditLog;
  readonly webhookDispatcher?: WebhookDispatcher;
}

export class EventService {
  private readonly config: EventServiceConfig;
  private readonly bus: EventBus;
  private readonly auditLog: AuditLog;
  private readonly webhookDispatcher: WebhookDispatcher;
  private readonly internalUnsubscribers: Unsubscribe[] = [];

  constructor(options: EventServiceOptions = {}) {
    this.config = { ...DEFAULT_EVENT_SERVICE_CONFIG, ...options.config };
    this.bus = options.bus ?? createEventBus(this.config.source);
    this.auditLog = options.auditLog ?? createAuditLog(this.config.auditCapacity);
    this.webhookDispatcher = options.webhookDispatcher ?? createWebhookDispatcher();

    this.wireInternalHandlers();
  }

  async emit<TPayload extends ServerEventPayload>(
    type: ServerEventType,
    payload: TPayload,
  ): Promise<ServerEvent<TPayload>> {
    return this.bus.publish(type, payload, this.config.source);
  }

  on<TPayload extends ServerEventPayload>(
    eventType: ServerEventType | "*",
    handler: EventHandler<TPayload>,
  ): Unsubscribe {
    return this.bus.subscribe(eventType, handler);
  }

  once<TPayload extends ServerEventPayload>(
    eventType: ServerEventType,
    handler: EventHandler<TPayload>,
  ): Unsubscribe {
    return this.bus.subscribeOnce(eventType, handler);
  }

  audit(entry: Omit<AuditEntry, "id"> & { id?: string }): AuditEntry {
    return this.auditLog.append(entry);
  }

  queryAudit(filters?: AuditQuery): AuditEntry[] {
    return this.auditLog.query(filters);
  }

  getRecentAudit(limit?: number): AuditEntry[] {
    return this.auditLog.getRecent(limit);
  }

  registerWebhook(config: WebhookConfig): void {
    this.webhookDispatcher.register(config);
  }

  unregisterWebhook(webhookId: string): boolean {
    return this.webhookDispatcher.unregister(webhookId);
  }

  listWebhooks(): WebhookConfig[] {
    return this.webhookDispatcher.list();
  }

  async emitRoomCreated(roomId: string, peerCount = 0): Promise<ServerEvent> {
    return this.emit(EventTypes.ROOM_CREATED, { roomId, peerCount });
  }

  async emitPeerJoined(roomId: string, peerId: string, displayName?: string): Promise<ServerEvent> {
    return this.emit(EventTypes.PEER_JOINED, { roomId, peerId, displayName });
  }

  async emitPeerLeft(roomId: string, peerId: string): Promise<ServerEvent> {
    return this.emit(EventTypes.PEER_LEFT, { roomId, peerId });
  }

  async emitAuthFailure(reason: string, subject?: string, roomId?: string): Promise<ServerEvent> {
    return this.emit(EventTypes.AUTH_FAILURE, { reason, subject, roomId });
  }

  async emitPolicyViolation(
    policy: string,
    action: string,
    details?: { subject?: string; roomId?: string; details?: string },
  ): Promise<ServerEvent> {
    return this.emit(EventTypes.POLICY_VIOLATION, {
      policy,
      action,
      ...details,
    });
  }

  getBus(): EventBus {
    return this.bus;
  }

  getAuditLog(): AuditLog {
    return this.auditLog;
  }

  getWebhookDispatcher(): WebhookDispatcher {
    return this.webhookDispatcher;
  }

  getConfig(): Readonly<EventServiceConfig> {
    return this.config;
  }

  getWebhookDeliveryHistory(limit?: number): WebhookDeliveryResult[] {
    return this.webhookDispatcher.getDeliveryHistory(limit);
  }

  close(): void {
    for (const unsub of this.internalUnsubscribers) {
      unsub();
    }
    this.internalUnsubscribers.length = 0;
    this.bus.clear();
    this.webhookDispatcher.clear();
  }

  private wireInternalHandlers(): void {
    const auditUnsub = this.bus.subscribe("*", async (event) => {
      this.auditLog.recordEvent(event);
    });
    this.internalUnsubscribers.push(auditUnsub);

    if (this.config.webhooksEnabled) {
      const webhookUnsub = this.bus.subscribe("*", async (event) => {
        await this.webhookDispatcher.dispatch(event);
      });
      this.internalUnsubscribers.push(webhookUnsub);
    }
  }
}

export function createEventService(options?: EventServiceOptions): EventService {
  return new EventService(options);
}
