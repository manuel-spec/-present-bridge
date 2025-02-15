import Fastify from "fastify";
import { createAdminService } from "../admin/admin-service.js";
import type { Env } from "../config/env.js";
import type { RoomService } from "../domain/room/room-service.js";
import type { SfuService } from "../media/sfu-service.js";
import { createMetricsService } from "../metrics/metrics-service.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInfoRoutes } from "./routes/info.js";
import { registerRoomRoutes } from "./routes/rooms.js";
import { registerSignalingWebSocket } from "./websocket/signaling.js";

export interface AppServices {
  roomService: RoomService;
  sfuService: SfuService;
}

export async function createApp(env: Env, services: AppServices) {
  const app = Fastify({
    logger: {
      level: env.devMode ? "debug" : "info",
    },
  });

  app.addHook("onRequest", async (request) => {
    request.log.debug({ url: request.url, method: request.method }, "incoming request");
  });

  registerHealthRoutes(app);
  registerInfoRoutes(app, env);
  registerRoomRoutes(app, services.roomService);

  const adminService = createAdminService({ roomService: services.roomService });
  const metricsService = createMetricsService({
    roomService: services.roomService,
    version: env.version,
  });
  registerAdminRoutes(app, {
    adminService,
    metricsService,
    version: env.version,
  });

  await registerSignalingWebSocket(app, env, services.roomService, services.sfuService);

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  return app;
}
