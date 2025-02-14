import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("parses a valid production configuration", () => {
    const env = parseEnv({
      ANNOUNCED_IP: "192.168.1.50",
      HTTP_PORT: "4000",
      RTC_MIN_PORT: "40000",
      RTC_MAX_PORT: "40100",
      MDNS_ENABLED: "false",
    });

    expect(env.announcedIp).toBe("192.168.1.50");
    expect(env.httpPort).toBe(4000);
    expect(env.mdnsEnabled).toBe(false);
    expect(env.wsPath).toBe("/ws");
  });

  it("defaults announced IP in dev mode", () => {
    const env = parseEnv({ DEV_MODE: "true" });
    expect(env.announcedIp).toBe("127.0.0.1");
    expect(env.devMode).toBe(true);
  });

  it("rejects missing announced IP outside dev mode", () => {
    expect(() => parseEnv({ DEV_MODE: "false" })).toThrow(EnvValidationError);
  });

  it("rejects invalid RTC port range", () => {
    expect(() =>
      parseEnv({
        DEV_MODE: "true",
        RTC_MIN_PORT: "50000",
        RTC_MAX_PORT: "40000",
      }),
    ).toThrow(EnvValidationError);
  });

  it("rejects invalid HTTP port", () => {
    expect(() =>
      parseEnv({
        DEV_MODE: "true",
        HTTP_PORT: "not-a-number",
      }),
    ).toThrow(EnvValidationError);
  });

  it("honours optional mediasoup worker count", () => {
    const env = parseEnv({ DEV_MODE: "true", MEDIASOUP_WORKER_COUNT: "2" });
    expect(env.mediasoupWorkerCount).toBe(2);
  });

  it("defaults LAN scan settings", () => {
    const env = parseEnv({ DEV_MODE: "true" });
    expect(env.lanScanEnabled).toBe(true);
    expect(env.lanScanTimeoutMs).toBe(5000);
    expect(env.lanScanConcurrency).toBe(64);
    expect(env.lanScanMdnsEnabled).toBe(true);
  });
});
