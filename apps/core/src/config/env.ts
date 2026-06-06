import os from "node:os";
import { z } from "zod";
import {
  APP_VERSION,
  DEFAULT_HTTP_PORT,
  DEFAULT_RTC_MAX_PORT,
  DEFAULT_RTC_MIN_PORT,
  WS_PATH,
} from "@bridge-packet/shared";

const envSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_HTTP_PORT),
  ANNOUNCED_IP: z.string().optional(),
  RTC_MIN_PORT: z.coerce.number().int().min(1024).max(65535).default(DEFAULT_RTC_MIN_PORT),
  RTC_MAX_PORT: z.coerce.number().int().min(1024).max(65535).default(DEFAULT_RTC_MAX_PORT),
  MEDIASOUP_WORKER_COUNT: z.coerce.number().int().min(1).max(32).optional(),
  MDNS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  MDNS_SERVICE_NAME: z.string().min(1).default("bridge-packet"),
  DEV_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  LAN_SCAN_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  LAN_SCAN_TIMEOUT_MS: z.coerce.number().int().min(500).max(60000).default(5000),
  LAN_SCAN_CONCURRENCY: z.coerce.number().int().min(1).max(256).default(64),
  LAN_SCAN_MDNS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

export type Env = {
  host: string;
  httpPort: number;
  announcedIp: string;
  rtcMinPort: number;
  rtcMaxPort: number;
  mediasoupWorkerCount: number;
  mdnsEnabled: boolean;
  mdnsServiceName: string;
  devMode: boolean;
  lanScanEnabled: boolean;
  lanScanTimeoutMs: number;
  lanScanConcurrency: number;
  lanScanMdnsEnabled: boolean;
  wsPath: string;
  version: string;
};

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvValidationError";
  }
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new EnvValidationError(
      `Invalid environment configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
    );
  }

  const raw = parsed.data;

  if (raw.RTC_MIN_PORT >= raw.RTC_MAX_PORT) {
    throw new EnvValidationError("RTC_MIN_PORT must be less than RTC_MAX_PORT");
  }

  const announcedIp = raw.ANNOUNCED_IP ?? (raw.DEV_MODE ? "127.0.0.1" : undefined);

  if (!announcedIp) {
    throw new EnvValidationError(
      "ANNOUNCED_IP is required. Set your LAN IP so mobile and desktop clients can connect via WebRTC.",
    );
  }

  return {
    host: raw.HOST,
    httpPort: raw.HTTP_PORT,
    announcedIp,
    rtcMinPort: raw.RTC_MIN_PORT,
    rtcMaxPort: raw.RTC_MAX_PORT,
    mediasoupWorkerCount: raw.MEDIASOUP_WORKER_COUNT ?? os.cpus().length,
    mdnsEnabled: raw.MDNS_ENABLED,
    mdnsServiceName: raw.MDNS_SERVICE_NAME,
    devMode: raw.DEV_MODE,
    lanScanEnabled: raw.LAN_SCAN_ENABLED,
    lanScanTimeoutMs: raw.LAN_SCAN_TIMEOUT_MS,
    lanScanConcurrency: raw.LAN_SCAN_CONCURRENCY,
    lanScanMdnsEnabled: raw.LAN_SCAN_MDNS_ENABLED,
    wsPath: WS_PATH,
    version: APP_VERSION,
  };
}
