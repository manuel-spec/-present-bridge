import Bonjour from "bonjour-service";
import { MDNS_PROTOCOL, MDNS_SERVICE_TYPE, WS_PATH } from "@bridge-packet/shared";
import type { Env } from "../config/env.js";

export class MdnsBroadcaster {
  private bonjour: Bonjour | null = null;
  private service: ReturnType<Bonjour["publish"]> | null = null;

  constructor(private readonly env: Env) {}

  start(): void {
    if (!this.env.mdnsEnabled) {
      return;
    }

    this.bonjour = new Bonjour();
    this.service = this.bonjour.publish({
      name: this.env.mdnsServiceName,
      type: MDNS_SERVICE_TYPE,
      protocol: MDNS_PROTOCOL,
      port: this.env.httpPort,
      txt: {
        path: WS_PATH,
        version: this.env.version,
        announcedIp: this.env.announcedIp,
      },
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.service) {
        this.service.stop(() => resolve());
        this.service = null;
      } else {
        resolve();
      }
    });

    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
  }
}
