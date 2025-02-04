import * as mediasoup from "mediasoup";
import type { types as MediasoupTypes } from "mediasoup";
import type { Env } from "../config/env.js";

export class WorkerPool {
  private readonly workers: MediasoupTypes.Worker[] = [];
  private nextWorkerIndex = 0;

  constructor(private readonly env: Env) {}

  async start(): Promise<void> {
    for (let index = 0; index < this.env.mediasoupWorkerCount; index += 1) {
      const worker = await mediasoup.createWorker({
        logLevel: "warn",
        rtcMinPort: this.env.rtcMinPort,
        rtcMaxPort: this.env.rtcMaxPort,
      });

      worker.on("died", () => {
        console.error(`mediasoup worker ${worker.pid} died, exiting`);
        process.exit(1);
      });

      this.workers.push(worker);
    }
  }

  getNextWorker(): MediasoupTypes.Worker {
    const worker = this.workers[this.nextWorkerIndex];
    if (!worker) {
      throw new Error("No mediasoup workers available");
    }

    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    this.workers.length = 0;
  }
}
