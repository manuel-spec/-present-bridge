import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createTestEnv } from "../../test/helpers.js";
import { registerInfoRoutes } from "./info.js";

describe("registerInfoRoutes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerInfoRoutes(app, createTestEnv());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns server connection details", async () => {
    const env = createTestEnv();
    const response = await app.inject({ method: "GET", url: "/info" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      host: env.host,
      announcedIp: env.announcedIp,
      httpPort: env.httpPort,
      wsPath: env.wsPath,
      wsUrl: `ws://${env.announcedIp}:${env.httpPort}${env.wsPath}`,
      rtcMinPort: env.rtcMinPort,
      rtcMaxPort: env.rtcMaxPort,
      version: env.version,
      mdnsEnabled: env.mdnsEnabled,
      mdnsServiceName: env.mdnsServiceName,
    });
  });
});
