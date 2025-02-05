import type { FastifyInstance } from "fastify";
import type { ServerInfo } from "@packet-bridge/shared";
import type { Env } from "../../config/env.js";

export function registerInfoRoutes(app: FastifyInstance, env: Env): void {
  app.get("/info", async (_request, reply) => {
    const response: ServerInfo = {
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
    };
    return reply.send(response);
  });
}
