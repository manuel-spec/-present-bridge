import type { RoomService } from "../domain/room/room-service.js";
import type {
  DiagnosticFinding,
  PeerDiagnosticEntry,
  RoomDiagnosticEntry,
  RoomInspectionSnapshot,
} from "./types.js";
import { ageSecondsFromIso } from "./types.js";
import { inspectPeerSession } from "./peer-inspector.js";

/** Options controlling room inspection depth. */
export interface RoomInspectorOptions {
  readonly maxRooms?: number;
  readonly maxPeersPerRoom?: number;
  readonly includePeerDetails?: boolean;
}

const DEFAULT_ROOM_INSPECTOR_OPTIONS: Required<RoomInspectorOptions> = {
  maxRooms: 100,
  maxPeersPerRoom: 50,
  includePeerDetails: true,
};

/**
 * Inspects room state from RoomService for admin diagnostics.
 * Provides room listings, peer counts, and per-room peer details.
 */
export class RoomInspector {
  private readonly roomService: RoomService;
  private readonly options: Required<RoomInspectorOptions>;

  constructor(roomService: RoomService, options: RoomInspectorOptions = {}) {
    this.roomService = roomService;
    this.options = { ...DEFAULT_ROOM_INSPECTOR_OPTIONS, ...options };
  }

  /** Collects a snapshot of all active rooms. */
  collect(): RoomInspectionSnapshot {
    const collectedAtMs = Date.now();
    const summaries = this.roomService.listRooms();
    const limited = summaries.slice(0, this.options.maxRooms);

    const rooms: RoomDiagnosticEntry[] = limited.map((summary) =>
      this.inspectRoom(summary.roomId, summary.createdAt, summary.peerCount, collectedAtMs),
    );

    const totalPeers = rooms.reduce((sum, room) => sum + room.peerCount, 0);

    return {
      collectedAtMs,
      totalRooms: summaries.length,
      totalPeers,
      rooms: Object.freeze(rooms),
    };
  }

  /** Inspects a single room by ID. */
  inspectRoomById(roomId: string): RoomDiagnosticEntry {
    const summary = this.roomService.getRoom(roomId);
    return this.inspectRoom(roomId, summary.createdAt, summary.peerCount, Date.now());
  }

  /** Returns peer count for a specific room. */
  getPeerCount(roomId: string): number {
    return this.roomService.getPeersInRoom(roomId).length;
  }

  /** Lists room IDs currently active. */
  listRoomIds(): string[] {
    return this.roomService.listRooms().map((room) => room.roomId);
  }

  /** Analyzes room snapshot and returns diagnostic findings. */
  analyze(snapshot: RoomInspectionSnapshot): DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];

    if (snapshot.totalRooms === 0) {
      findings.push({
        code: "NO_ACTIVE_ROOMS",
        severity: "info",
        component: "rooms",
        message: "No active rooms",
      });
      return findings;
    }

    findings.push({
      code: "ROOMS_ACTIVE",
      severity: "info",
      component: "rooms",
      message: `${snapshot.totalRooms} active room(s) with ${snapshot.totalPeers} total peer(s)`,
    });

    const largeRooms = snapshot.rooms.filter((room) => room.peerCount > 20);
    if (largeRooms.length > 0) {
      findings.push({
        code: "LARGE_ROOMS",
        severity: "warning",
        component: "rooms",
        message: `${largeRooms.length} room(s) have more than 20 peers`,
        metadata: { roomIds: largeRooms.map((r) => r.roomId) },
      });
    }

    const staleRooms = snapshot.rooms.filter((room) => room.ageSeconds > 86_400);
    if (staleRooms.length > 0) {
      findings.push({
        code: "STALE_ROOMS",
        severity: "warning",
        component: "rooms",
        message: `${staleRooms.length} room(s) older than 24 hours`,
        remediation: "Consider cleaning up abandoned rooms",
      });
    }

    const emptyRooms = snapshot.rooms.filter((room) => room.peerCount === 0);
    if (emptyRooms.length > 0) {
      findings.push({
        code: "EMPTY_ROOMS",
        severity: "warning",
        component: "rooms",
        message: `${emptyRooms.length} room(s) have zero peers`,
      });
    }

    if (snapshot.totalRooms > this.options.maxRooms) {
      findings.push({
        code: "ROOMS_TRUNCATED",
        severity: "info",
        component: "rooms",
        message: `Inspection limited to ${this.options.maxRooms} of ${snapshot.totalRooms} rooms`,
      });
    }

    return findings;
  }

  /** Finds rooms matching a predicate. */
  findRooms(
    predicate: (room: RoomDiagnosticEntry) => boolean,
  ): RoomDiagnosticEntry[] {
    return this.collect().rooms.filter(predicate);
  }

  /** Returns the room with the most peers. */
  largestRoom(): RoomDiagnosticEntry | null {
    const snapshot = this.collect();
    if (snapshot.rooms.length === 0) {
      return null;
    }
    return snapshot.rooms.reduce((largest, room) =>
      room.peerCount > largest.peerCount ? room : largest,
    );
  }

  /** Computes average peers per room. */
  averagePeersPerRoom(): number {
    const snapshot = this.collect();
    if (snapshot.totalRooms === 0) {
      return 0;
    }
    return snapshot.totalPeers / snapshot.totalRooms;
  }

  private inspectRoom(
    roomId: string,
    createdAt: string,
    peerCount: number,
    nowMs: number,
  ): RoomDiagnosticEntry {
    let peers: PeerDiagnosticEntry[] = [];

    if (this.options.includePeerDetails) {
      const peerInfos = this.roomService.getPeersInRoom(roomId).slice(0, this.options.maxPeersPerRoom);
      peers = peerInfos.map((peer) => {
        try {
          const session = this.roomService.getSession(peer.peerId);
          return inspectPeerSession(session);
        } catch {
          return {
            peerId: peer.peerId,
            displayName: peer.displayName,
            roomId,
            socketOpen: false,
            transportCount: 0,
            producerCount: 0,
            consumerCount: 0,
            hasActiveMedia: false,
          };
        }
      });
    }

    return {
      roomId,
      peerCount,
      createdAt,
      ageSeconds: ageSecondsFromIso(createdAt, nowMs),
      peers: Object.freeze(peers),
    };
  }
}

export function createRoomInspector(
  roomService: RoomService,
  options?: RoomInspectorOptions,
): RoomInspector {
  return new RoomInspector(roomService, options);
}

export function summarizeRooms(snapshot: RoomInspectionSnapshot): string {
  return `${snapshot.totalRooms} rooms, ${snapshot.totalPeers} peers`;
}

export function roomHasMediaActivity(room: RoomDiagnosticEntry): boolean {
  return room.peers.some((peer) => peer.hasActiveMedia);
}
