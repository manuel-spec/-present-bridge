export interface LocalNetwork {
  interfaceName: string;
  address: string;
  netmask: string;
  cidr: number;
}

export interface LanDevice {
  ip: string;
  hostname?: string;
  mac?: string;
  latencyMs?: number;
  sources: Array<"ping" | "mdns">;
  services: LanDeviceService[];
}

export interface LanDeviceService {
  name: string;
  type: string;
  port: number;
  txt?: Record<string, string>;
}

export interface LanScanResult {
  scannedAt: string;
  durationMs: number;
  networks: LocalNetwork[];
  devices: LanDevice[];
}

export interface ScanLogger {
  info: (payload: Record<string, unknown>, message: string) => void;
  warn: (payload: Record<string, unknown>, message: string) => void;
}
