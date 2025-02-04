import type { FastifyInstance } from "fastify";
import type { WorkerPool } from "../media/worker-pool.js";
import type { MdnsBroadcaster } from "../discovery/mdns.js";
import type { RoomService } from "../domain/room/room-service.js";

export interface ShutdownContext {
  app: FastifyInstance;
  workerPool: WorkerPool;
  mdnsBroadcaster: MdnsBroadcaster | null;
  roomService: RoomService;
}

export async function shutdown(context: ShutdownContext): Promise<void> {
  const { app, workerPool, mdnsBroadcaster, roomService } = context;

  roomService.closeAll();

  if (mdnsBroadcaster) {
    await mdnsBroadcaster.stop();
  }

  await workerPool.close();
  await app.close();
}
