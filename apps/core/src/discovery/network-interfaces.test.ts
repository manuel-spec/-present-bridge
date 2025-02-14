import { describe, expect, it } from "vitest";
import {
  enumerateHostAddresses,
  getLocalIPv4Networks,
  isPrivateIPv4,
  netmaskToCidr,
} from "./network-interfaces.js";

describe("network-interfaces", () => {
  it("detects private IPv4 addresses", () => {
    expect(isPrivateIPv4("10.0.0.1")).toBe(true);
    expect(isPrivateIPv4("172.16.0.1")).toBe(true);
    expect(isPrivateIPv4("192.168.1.1")).toBe(true);
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
  });

  it("skips interfaces with missing entries", () => {
    expect(getLocalIPv4Networks({ eth0: undefined })).toEqual([]);
  });

  it("collects local private IPv4 networks", () => {
    const networks = getLocalIPv4Networks({
      eth0: [
        { family: "IPv4", address: "192.168.1.50", netmask: "255.255.255.0", internal: false, mac: "", cidr: 24, scopeid: 0 },
        { family: "IPv6", address: "fe80::1", netmask: "ffff:ffff:ffff:ffff::", internal: false, mac: "", cidr: 64, scopeid: 0 },
        { family: "IPv4", address: "127.0.0.1", netmask: "255.0.0.0", internal: true, mac: "", cidr: 8, scopeid: 0 },
      ],
    });

    expect(networks).toEqual([
      {
        interfaceName: "eth0",
        address: "192.168.1.50",
        netmask: "255.255.255.0",
        cidr: 24,
      },
    ]);
  });

  it("enumerates host addresses for a subnet", () => {
    const hosts = enumerateHostAddresses("192.168.1.50", "255.255.255.0", ["192.168.1.50"]);
    expect(hosts[0]).toBe("192.168.1.1");
    expect(hosts.at(-1)).toBe("192.168.1.254");
    expect(hosts).not.toContain("192.168.1.50");
    expect(hosts).toHaveLength(253);
  });

  it("converts netmask to CIDR", () => {
    expect(netmaskToCidr("255.255.255.0")).toBe(24);
  });
});
