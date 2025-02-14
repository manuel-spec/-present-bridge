import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrency, pingHost } from "./ping-probe.js";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:os", () => ({
  default: {
    platform: vi.fn(() => "linux"),
  },
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:util", () => ({
  promisify: () => execFileMock,
}));

describe("ping-probe", () => {
  it("reports alive hosts on unix ping success", async () => {
    execFileMock.mockResolvedValue({ stdout: "64 bytes from 192.168.1.10: icmp_seq=1 ttl=64 time=3.2 ms" });

    await expect(pingHost("192.168.1.10", 1000)).resolves.toEqual({
      ip: "192.168.1.10",
      alive: true,
      latencyMs: 3,
    });
  });

  it("reports dead hosts when ping fails", async () => {
    execFileMock.mockRejectedValue(new Error("timeout"));

    await expect(pingHost("192.168.1.99", 1000)).resolves.toEqual({
      ip: "192.168.1.99",
      alive: false,
    });
  });

  it("limits concurrent work", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return value * 2;
    });

    expect(results).toEqual([2, 4, 6, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
