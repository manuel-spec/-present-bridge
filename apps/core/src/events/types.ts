/**
 * Server event, audit log, and webhook type definitions.
 */

export const ServerEventType = {
  ROOM_CREATED: "room.created",
  ROOM_DELETED: "room.deleted",
  PEER_JOINED: "peer.joined",
  PEER_LEFT: "peer.left",
  TRANSPORT_CREATED: "transport.created",
  TRANSPORT_CLOSED: "transport.closed",
  PRODUCER_CREATED: "producer.created",
  PRODUCER_CLOSED: "producer.closed",
  CONSUMER_CREATED: "consumer.created",
  CONSUMER_CLOSED: "consumer.closed",
  AUTH_SUCCESS: "auth.success",
  AUTH_FAILURE: "auth.failure",
  POLICY_VIOLATION: "policy.violation",
  RATE_LIMIT_EXCEEDED: "rate_limit.exceeded",
  WEBHOOK_DELIVERED: "webhook.delivered",
  WEBHOOK_FAILED: "webhook.failed",
  SERVER_STARTED: "server.started",
  SERVER_STOPPING: "server.stopping",
} as const;

export type ServerEventType = (typeof ServerEventType)[keyof typeof ServerEventType];

export interface BaseServerEvent {
  readonly type: ServerEventType;
  readonly timestamp: string;
  readonly eventId: string;
  readonly source: string;
}

export interface RoomEventPayload {
  readonly roomId: string;
  readonly peerCount?: number;
}

export interface PeerEventPayload extends RoomEventPayload {
  readonly peerId: string;
  readonly displayName?: string;
}

export interface MediaEventPayload extends PeerEventPayload {
  readonly transportId?: string;
  readonly producerId?: string;
  readonly consumerId?: string;
  readonly kind?: "audio" | "video";
}

export interface AuthEventPayload {
  readonly subject?: string;
  readonly roomId?: string;
  readonly reason?: string;
}

export interface PolicyEventPayload {
  readonly policy: string;
  readonly action: string;
  readonly subject?: string;
  readonly roomId?: string;
  readonly details?: string;
}

export interface WebhookEventPayload {
  readonly webhookId: string;
  readonly url: string;
  readonly statusCode?: number;
  readonly attempt?: number;
  readonly error?: string;
}

export interface ServerLifecyclePayload {
  readonly version?: string;
  readonly host?: string;
  readonly port?: number;
}

export type ServerEventPayload =
  | RoomEventPayload
  | PeerEventPayload
  | MediaEventPayload
  | AuthEventPayload
  | PolicyEventPayload
  | WebhookEventPayload
  | ServerLifecyclePayload
  | Record<string, unknown>;

export interface ServerEvent<TPayload extends ServerEventPayload = ServerEventPayload> extends BaseServerEvent {
  readonly payload: TPayload;
}

export const AuditSeverity = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
} as const;

export type AuditSeverity = (typeof AuditSeverity)[keyof typeof AuditSeverity];

export interface AuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly severity: AuditSeverity;
  readonly category: string;
  readonly action: string;
  readonly actor?: string;
  readonly resource?: string;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly eventId?: string;
}

export interface AuditQuery {
  readonly since?: string;
  readonly until?: string;
  readonly severity?: AuditSeverity;
  readonly category?: string;
  readonly actor?: string;
  readonly limit?: number;
}

export const WebhookDeliveryMode = {
  FIRE_AND_FORGET: "fire_and_forget",
  AT_LEAST_ONCE: "at_least_once",
} as const;

export type WebhookDeliveryMode = (typeof WebhookDeliveryMode)[keyof typeof WebhookDeliveryMode];

export interface WebhookConfig {
  readonly id: string;
  readonly url: string;
  readonly secret?: string;
  readonly enabled: boolean;
  readonly eventTypes: readonly ServerEventType[];
  readonly deliveryMode: WebhookDeliveryMode;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly timeoutMs: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface WebhookDeliveryResult {
  readonly webhookId: string;
  readonly eventId: string;
  readonly success: boolean;
  readonly statusCode?: number;
  readonly attempts: number;
  readonly error?: string;
  readonly deliveredAt?: string;
}

export type EventHandler<TPayload extends ServerEventPayload = ServerEventPayload> = (
  event: ServerEvent<TPayload>,
) => void | Promise<void>;

export type Unsubscribe = () => void;

export interface EventBusStats {
  readonly subscriberCount: number;
  readonly eventTypes: readonly ServerEventType[];
  readonly totalPublished: number;
}

export interface AuditLogStats {
  readonly capacity: number;
  readonly size: number;
  readonly dropped: number;
}

export interface EventServiceConfig {
  readonly source: string;
  readonly auditCapacity: number;
  readonly webhooksEnabled: boolean;
}

export const DEFAULT_EVENT_SERVICE_CONFIG: EventServiceConfig = {
  source: "bridge-packet-core",
  auditCapacity: 1000,
  webhooksEnabled: true,
};

export function isServerEventType(value: string): value is ServerEventType {
  return Object.values(ServerEventType).includes(value as ServerEventType);
}

export function createEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createAuditId(): string {
  return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function eventMatchesWebhook(event: ServerEvent, webhook: WebhookConfig): boolean {
  if (!webhook.enabled) {
    return false;
  }
  if (webhook.eventTypes.length === 0) {
    return true;
  }
  return webhook.eventTypes.includes(event.type);
}

export function severityForEventType(type: ServerEventType): AuditSeverity {
  switch (type) {
    case ServerEventType.AUTH_FAILURE:
    case ServerEventType.POLICY_VIOLATION:
    case ServerEventType.RATE_LIMIT_EXCEEDED:
    case ServerEventType.WEBHOOK_FAILED:
      return AuditSeverity.WARN;
    default:
      return AuditSeverity.INFO;
  }
}
