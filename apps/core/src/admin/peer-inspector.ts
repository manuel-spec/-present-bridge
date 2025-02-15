import { WebSocket } from "ws";
import type { PeerSession } from "../domain/peer/peer-session.js";
import type { RoomService } from "../domain/room/room-service.js";
import type { DiagnosticFinding, PeerDiagnosticEntry, PeerInspectionSnapshot } from "./types.js";
import { AdminError } from "./types.js";

/** Options controlling peer inspection. */
export interface PeerInspectorOptions {
  readonly maxPeers?: number;
}

const DEFAULT_PEER_INSPECTOR_OPTIONS: Required<PeerInspectorOptions> = {
  maxPeers: 500,
};

/**
 * Inspects peer sessions for admin diagnostics.
 * Traverses rooms via RoomService public API to enumerate peers.
 */
export class PeerInspector {
  private readonly roomService: RoomService;
  private readonly options: Required<PeerInspectorOptions>;

  constructor(roomService: RoomService, options: PeerInspectorOptions = {}) {
    this.roomService = roomService;
    this.options = { ...DEFAULT_PEER_INSPECTOR_OPTIONS, ...options };
  }

  /** Collects a snapshot of all connected peers across rooms. */
  collect(): PeerInspectionSnapshot {
    const collectedAtMs = Date.now();
    const peers: PeerDiagnosticEntry[] = [];
    let peersWithMedia = 0;
    let peersWithoutRoom = 0;

    for (const room of this.roomService.listRooms()) {
      for (const peerInfo of this.roomService.getPeersInRoom(room.roomId)) {
        if (peers.length >= this.options.maxPeers) {
          break;
        }
        try {
          const session = this.roomService.getSession(peerInfo.peerId);
          const entry = inspectPeerSession(session);
          peers.push(entry);
          if (entry.hasActiveMedia) {
            peersWithMedia += 1;
          }
          if (entry.roomId === null) {
            peersWithoutRoom += 1;
          }
        } catch {
          peers.push({
            peerId: peerInfo.peerId,
            displayName: peerInfo.displayName,
            roomId: room.roomId,
            socketOpen: false,
            transportCount: 0,
            producerCount: 0,
            consumerCount: 0,
            hasActiveMedia: false,
          });
        }
      }
      if (peers.length >= this.options.maxPeers) {
        break;
      }
    }

    return {
      collectedAtMs,
      totalPeers: peers.length,
      peersWithMedia,
      peersWithoutRoom,
      peers: Object.freeze(peers),
    };
  }

  /** Inspects a single peer by ID. */
  inspectPeer(peerId: string): PeerDiagnosticEntry {
    try {
      const session = this.roomService.getSession(peerId);
      return inspectPeerSession(session);
    } catch {
      throw new AdminError("PEER_NOT_FOUND", `Peer not found: ${peerId}`);
    }
  }

  /** Returns peers in a specific room with full diagnostic detail. */
  inspectPeersInRoom(roomId: string): PeerDiagnosticEntry[] {
    return this.roomService.getPeersInRoom(roomId).map((peer) => {
      try {
        return inspectPeerSession(this.roomService.getSession(peer.peerId));
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

  /** Analyzes peer snapshot and returns findings. */
  analyze(snapshot: PeerInspectionSnapshot): DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];

    if (snapshot.totalPeers === 0) {
      findings.push({
        code: "NO_PEERS",
        severity: "info",
        component: "peers",
        message: "No connected peers",
      });
      return findings;
    }

    findings.push({
      code: "PEERS_CONNECTED",
      severity: "info",
      component: "peers",
      message: `${snapshot.totalPeers} peer(s) connected, ${snapshot.peersWithMedia} with active media`,
    });

    const closedSockets = snapshot.peers.filter((p) => !p.socketOpen);
    if (closedSockets.length > 0) {
      findings.push({
        code: "PEERS_SOCKET_CLOSED",
        severity: "warning",
        component: "peers",
        message: `${closedSockets.length} peer(s) have closed WebSocket connections`,
        metadata: { peerIds: closedSockets.map((p) => p.peerId) },
      });
    }

    const mediaHeavy = snapshot.peers.filter(
      (p) => p.producerCount + p.consumerCount > 10,
    );
    if (mediaHeavy.length > 0) {
      findings.push({
        code: "PEERS_HIGH_MEDIA",
        severity: "warning",
        component: "peers",
        message: `${mediaHeavy.length} peer(s) have more than 10 media objects`,
      });
    }

    if (snapshot.peersWithoutRoom > 0) {
      findings.push({
        code: "PEERS_ORPHANED",
        severity: "error",
        component: "peers",
        message: `${snapshot.peersWithoutRoom} peer(s) lack a room assignment`,
      });
    }

    return findings;
  }

  /** Counts peers with active media objects. */
  countPeersWithMedia(): number {
    return this.collect().peersWithMedia;
  }

  /** Finds peers matching a predicate. */
  findPeers(predicate: (peer: PeerDiagnosticEntry) => boolean): PeerDiagnosticEntry[] {
    return this.collect().peers.filter(predicate);
  }

  /** Groups peers by room ID. */
  groupByRoom(): Map<string, PeerDiagnosticEntry[]> {
    const groups = new Map<string, PeerDiagnosticEntry[]>();
    for (const peer of this.collect().peers) {
      const roomId = peer.roomId ?? "unassigned";
      const existing = groups.get(roomId);
      if (existing) {
        existing.push(peer);
      } else {
        groups.set(roomId, [peer]);
      }
    }
    return groups;
  }
}

/** Converts a PeerSession into a diagnostic entry. */
export function inspectPeerSession(session: PeerSession): PeerDiagnosticEntry {
  const transportCount = session.transports.size;
  const producerCount = session.producers.size;
  const consumerCount = session.consumers.size;

  return {
    peerId: session.peerId,
    displayName: session.displayName,
    roomId: session.roomId,
    socketOpen: session.socket.readyState === WebSocket.OPEN,
    transportCount,
    producerCount,
    consumerCount,
    hasActiveMedia: transportCount > 0 || producerCount > 0 || consumerCount > 0,
  };
}

export function createPeerInspector(
  roomService: RoomService,
  options?: PeerInspectorOptions,
): PeerInspector {
  return new PeerInspector(roomService, options);
}

export function summarizePeers(snapshot: PeerInspectionSnapshot): string {
  return `${snapshot.totalPeers} peers (${snapshot.peersWithMedia} with media)`;
}

export function peerMediaObjectCount(peer: PeerDiagnosticEntry): number {
  return peer.transportCount + peer.producerCount + peer.consumerCount;
}
