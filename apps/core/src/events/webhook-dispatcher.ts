import { createHmac } from "node:crypto";
import {
  type ServerEvent,
  type WebhookConfig,
  type WebhookDeliveryResult,
  WebhookDeliveryMode,
  eventMatchesWebhook,
} from "./types.js";

export type WebhookFetchFn = (
  url: string,
  init: RequestInit,
) => Promise<{ status: number; ok: boolean }>;

export interface WebhookDispatcherOptions {
  readonly fetchFn?: WebhookFetchFn;
  readonly defaultTimeoutMs?: number;
}

export class WebhookDispatcher {
  private readonly webhooks = new Map<string, WebhookConfig>();
  private readonly fetchFn: WebhookFetchFn;
  private readonly defaultTimeoutMs: number;
  private readonly deliveryHistory: WebhookDeliveryResult[] = [];
  private readonly maxHistory = 500;

  constructor(options: WebhookDispatcherOptions = {}) {
    this.fetchFn = options.fetchFn ?? this.defaultFetch;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5000;
  }

  register(config: WebhookConfig): void {
    this.webhooks.set(config.id, Object.freeze({ ...config }));
  }

  unregister(webhookId: string): boolean {
    return this.webhooks.delete(webhookId);
  }

  get(webhookId: string): WebhookConfig | undefined {
    return this.webhooks.get(webhookId);
  }

  list(): WebhookConfig[] {
    return [...this.webhooks.values()];
  }

  clear(): void {
    this.webhooks.clear();
  }

  async dispatch(event: ServerEvent): Promise<WebhookDeliveryResult[]> {
    const results: WebhookDeliveryResult[] = [];

    for (const webhook of this.webhooks.values()) {
      if (!eventMatchesWebhook(event, webhook)) {
        continue;
      }

      const result = await this.deliver(webhook, event);
      results.push(result);
      this.recordResult(result);
    }

    return results;
  }

  async deliver(webhook: WebhookConfig, event: ServerEvent): Promise<WebhookDeliveryResult> {
    const body = JSON.stringify({
      event,
      deliveredAt: new Date().toISOString(),
    });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-bridge-packet-event": event.type,
      "x-bridge-packet-event-id": event.eventId,
      ...(webhook.headers ?? {}),
    };

    if (webhook.secret) {
      headers["x-bridge-packet-signature"] = this.signPayload(body, webhook.secret);
    }

    const maxAttempts =
      webhook.deliveryMode === WebhookDeliveryMode.FIRE_AND_FORGET
        ? 1
        : Math.max(1, webhook.maxRetries + 1);

    let lastError: string | undefined;
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(
          webhook.url,
          { method: "POST", headers, body },
          webhook.timeoutMs || this.defaultTimeoutMs,
        );

        lastStatus = response.status;

        if (response.ok) {
          return {
            webhookId: webhook.id,
            eventId: event.eventId,
            success: true,
            statusCode: response.status,
            attempts: attempt,
            deliveredAt: new Date().toISOString(),
          };
        }

        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Webhook delivery failed";
      }

      if (attempt < maxAttempts) {
        await this.delay(webhook.retryDelayMs * attempt);
      }
    }

    return {
      webhookId: webhook.id,
      eventId: event.eventId,
      success: false,
      statusCode: lastStatus,
      attempts: maxAttempts,
      error: lastError,
    };
  }

  getDeliveryHistory(limit = 100): WebhookDeliveryResult[] {
    return this.deliveryHistory.slice(-limit);
  }

  getDeliveryHistoryForWebhook(webhookId: string, limit = 100): WebhookDeliveryResult[] {
    return this.deliveryHistory.filter((entry) => entry.webhookId === webhookId).slice(-limit);
  }

  signPayload(body: string, secret: string): string {
    return createHmac("sha256", secret).update(body).digest("hex");
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<{ status: number; ok: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async defaultFetch(
    url: string,
    init: RequestInit,
  ): Promise<{ status: number; ok: boolean }> {
    const response = await fetch(url, init);
    return { status: response.status, ok: response.ok };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private recordResult(result: WebhookDeliveryResult): void {
    this.deliveryHistory.push(result);
    if (this.deliveryHistory.length > this.maxHistory) {
      this.deliveryHistory.shift();
    }
  }
}

export function createWebhookDispatcher(options?: WebhookDispatcherOptions): WebhookDispatcher {
  return new WebhookDispatcher(options);
}

export function createWebhookConfig(
  partial: Pick<WebhookConfig, "id" | "url"> & Partial<Omit<WebhookConfig, "id" | "url">>,
): WebhookConfig {
  return Object.freeze({
    enabled: true,
    eventTypes: [],
    deliveryMode: WebhookDeliveryMode.AT_LEAST_ONCE,
    maxRetries: 3,
    retryDelayMs: 250,
    timeoutMs: 5000,
    ...partial,
  });
}
