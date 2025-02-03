import os from "node:os";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import {
  APP_VERSION,
  DEFAULT_HTTP_PORT,
  DEFAULT_RTC_MAX_PORT,
  DEFAULT_RTC_MIN_PORT,
  WS_PATH,
} from "@packet-bridge/shared";

loadDotenv();

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
  MDNS_SERVICE_NAME: z.string().min(1).default("packet-bridge"),
  DEV_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

if (raw.RTC_MIN_PORT >= raw.RTC_MAX_PORT) {
  console.error("RTC_MIN_PORT must be less than RTC_MAX_PORT");
  process.exit(1);
}

const announcedIp = raw.ANNOUNCED_IP ?? (raw.DEV_MODE ? "127.0.0.1" : undefined);

if (!announcedIp) {
  console.error(
    "ANNOUNCED_IP is required. Set your LAN IP so mobile and desktop clients can connect via WebRTC.",
  );
  process.exit(1);
}

export const env = {
  host: raw.HOST,
  httpPort: raw.HTTP_PORT,
  announcedIp,
  rtcMinPort: raw.RTC_MIN_PORT,
  rtcMaxPort: raw.RTC_MAX_PORT,
  mediasoupWorkerCount: raw.MEDIASOUP_WORKER_COUNT ?? os.cpus().length,
  mdnsEnabled: raw.MDNS_ENABLED,
  mdnsServiceName: raw.MDNS_SERVICE_NAME,
  devMode: raw.DEV_MODE,
  wsPath: WS_PATH,
  version: APP_VERSION,
};

export type Env = typeof env;
