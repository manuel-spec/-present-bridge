import Bonjour from "bonjour-service";
import { MDNS_SERVICE_TYPE } from "@bridge-packet/shared";
import type { LanDeviceService } from "./types.js";

interface DiscoveredMdnsService {
  name: string;
  type: string;
  host: string;
  port: number;
  addresses?: string[];
  txt?: Record<string, string>;
}

const DEFAULT_SERVICE_TYPES = [
  MDNS_SERVICE_TYPE,
  "http",
  "ssh",
  "airplay",
  "googlecast",
  "workstation",
] as const;

function toLanDeviceService(service: DiscoveredMdnsService): LanDeviceService {
  return {
    name: service.name,
    type: service.type,
    port: service.port,
    txt: service.txt,
  };
}

export function discoverMdnsServices(
  timeoutMs: number,
  serviceTypes: readonly string[] = DEFAULT_SERVICE_TYPES,
): Promise<Map<string, LanDeviceService[]>> {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const servicesByIp = new Map<string, LanDeviceService[]>();
    const browsers = serviceTypes.map((type) => bonjour.find({ type }));

    const recordService = (service: DiscoveredMdnsService) => {
      const addresses = service.addresses?.length ? service.addresses : [service.host];
      for (const ip of addresses) {
        if (!ip || ip.includes(":")) {
          continue;
        }

        const existing = servicesByIp.get(ip) ?? [];
        existing.push(toLanDeviceService(service));
        servicesByIp.set(ip, existing);
      }
    };

    for (const browser of browsers) {
      browser.on("up", recordService);
    }

    setTimeout(() => {
      for (const browser of browsers) {
        browser.stop();
      }
      bonjour.destroy();
      resolve(servicesByIp);
    }, timeoutMs);
  });
}
