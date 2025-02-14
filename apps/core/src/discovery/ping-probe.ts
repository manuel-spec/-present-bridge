import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PingResult {
  ip: string;
  alive: boolean;
  latencyMs?: number;
}

export async function pingHost(ip: string, timeoutMs: number): Promise<PingResult> {
  const platform = os.platform();

  try {
    if (platform === "win32") {
      const { stdout } = await execFileAsync(
        "ping",
        ["-n", "1", "-w", String(timeoutMs), ip],
        { timeout: timeoutMs + 1000, windowsHide: true },
      );
      const alive = /TTL=/i.test(stdout) && !/100% loss/i.test(stdout);
      const match = stdout.match(/time[<=](\d+(?:\.\d+)?)\s*ms/i);
      return { ip, alive, latencyMs: match ? Math.round(Number(match[1])) : undefined };
    }

    const waitSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const { stdout } = await execFileAsync(
      "ping",
      ["-c", "1", "-W", String(waitSeconds), ip],
      { timeout: timeoutMs + 1000 },
    );
    const match = stdout.match(/time=(\d+(?:\.\d+)?)\s*ms/i);
    return { ip, alive: true, latencyMs: match ? Math.round(Number(match[1])) : undefined };
  } catch {
    return { ip, alive: false };
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
