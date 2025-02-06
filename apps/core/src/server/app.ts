import Fastify from "fastify";
import type { Env } from "../config/env.js";
import type { RoomService } from "../domain/room/room-service.js";
import type { SfuService } from "../media/sfu-service.js";
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

  registerHealthRoutes(app);
  registerInfoRoutes(app, env);
  registerRoomRoutes(app, services.roomService);
  await registerSignalingWebSocket(app, env, services.roomService, services.sfuService);

  return app;
}
