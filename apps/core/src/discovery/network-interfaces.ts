import os from "node:os";
import type { LocalNetwork } from "./types.js";

function ipToLong(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function longToIp(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function netmaskToCidr(netmask: string): number {
  return netmask
    .split(".")
    .map((octet) => Number(octet))
    .reduce((acc, octet) => acc + octet.toString(2).replace(/0/g, "").length, 0);
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts[0] === 10) {
    return true;
  }
  if (parts[0] === 172 && parts[1] !== undefined && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  return false;
}

export function getLocalIPv4Networks(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): LocalNetwork[] {
  const networks: LocalNetwork[] = [];

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal || !isPrivateIPv4(entry.address)) {
        continue;
      }

      networks.push({
        interfaceName,
        address: entry.address,
        netmask: entry.netmask,
        cidr: netmaskToCidr(entry.netmask),
      });
    }
  }

  return networks;
}

export function enumerateHostAddresses(
  address: string,
  netmask: string,
  excludeAddresses: string[] = [],
): string[] {
  const mask = ipToLong(netmask);
  const network = ipToLong(address) & mask;
  const broadcast = network | (~mask >>> 0);
  const excluded = new Set(excludeAddresses);
  const hosts: string[] = [];

  for (let candidate = network + 1; candidate < broadcast; candidate += 1) {
    const ip = longToIp(candidate);
    if (!excluded.has(ip)) {
      hosts.push(ip);
    }
  }

  return hosts;
}

export { ipToLong, isPrivateIPv4, longToIp, netmaskToCidr };
