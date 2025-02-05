import type { types as MediasoupTypes } from "mediasoup";
import { mediaCodecs } from "./codecs.js";
import type { WorkerPool } from "./worker-pool.js";

export class RouterManager {
  private readonly routers = new Map<string, MediasoupTypes.Router>();

  constructor(private readonly workerPool: WorkerPool) {}

  async getOrCreateRouter(roomId: string): Promise<MediasoupTypes.Router> {
    const existing = this.routers.get(roomId);
    if (existing) {
      return existing;
    }

    const worker = this.workerPool.getNextWorker();
    const router = await worker.createRouter({ mediaCodecs });
    this.routers.set(roomId, router);
    return router;
  }

  getRouter(roomId: string): MediasoupTypes.Router | undefined {
    return this.routers.get(roomId);
  }

  async closeRouter(roomId: string): Promise<void> {
    const router = this.routers.get(roomId);
    if (router) {
      router.close();
      this.routers.delete(roomId);
    }
  }

  async closeAll(): Promise<void> {
    for (const roomId of [...this.routers.keys()]) {
      await this.closeRouter(roomId);
    }
  }
}
