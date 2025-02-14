import { MDNS_PROTOCOL, MDNS_SERVICE_TYPE } from "@packet-bridge/shared";
import type { Env } from "./config/env.js";
import { RoomService } from "./domain/room/room-service.js";
import { MdnsBroadcaster } from "./discovery/mdns.js";
import { LanScanner } from "./discovery/lan-scanner.js";
import { shutdown } from "./lib/shutdown.js";
import { RouterManager } from "./media/router-manager.js";
import { SfuService } from "./media/sfu-service.js";
import { WorkerPool } from "./media/worker-pool.js";
import { createApp } from "./server/app.js";

export interface BootstrapResult {
  app: Awaited<ReturnType<typeof createApp>>;
  workerPool: WorkerPool;
  routerManager: RouterManager;
  roomService: RoomService;
  sfuService: SfuService;
  mdnsBroadcaster: MdnsBroadcaster;
  shutdown: (signal: string) => Promise<void>;
}

export async function bootstrap(env: Env): Promise<BootstrapResult> {
  const workerPool = new WorkerPool(env);
  await workerPool.start();

  const routerManager = new RouterManager(workerPool);
  const roomService = new RoomService();
  const sfuService = new SfuService(env, routerManager);

  const app = await createApp(env, { roomService, sfuService });

  await app.listen({ host: env.host, port: env.httpPort });

  const mdnsBroadcaster = new MdnsBroadcaster(env);
  mdnsBroadcaster.start();

  app.log.info(
    {
      httpUrl: `http://${env.announcedIp}:${env.httpPort}`,
      wsUrl: `ws://${env.announcedIp}:${env.httpPort}${env.wsPath}`,
      infoUrl: `http://${env.announcedIp}:${env.httpPort}/info`,
      mdns: env.mdnsEnabled ? `${env.mdnsServiceName}.${MDNS_SERVICE_TYPE}.${MDNS_PROTOCOL}` : "disabled",
      rtcPorts: `${env.rtcMinPort}-${env.rtcMaxPort}`,
    },
    "Packet Bridge core server started",
  );

  if (env.lanScanEnabled) {
    const lanScanner = new LanScanner(env);
    void lanScanner.scanAndLog(app.log);
  }

  const runShutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    await shutdown({
      app,
      workerPool,
      mdnsBroadcaster: env.mdnsEnabled ? mdnsBroadcaster : null,
      roomService,
    });
    await routerManager.closeAll();
  };

  return {
    app,
    workerPool,
    routerManager,
    roomService,
    sfuService,
    mdnsBroadcaster,
    shutdown: runShutdown,
  };
}

export function registerSignalHandlers(shutdownFn: (signal: string) => Promise<void>): void {
  const handleShutdown = (signal: string) => {
    void shutdownFn(signal).then(() => process.exit(0));
  };

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
}
