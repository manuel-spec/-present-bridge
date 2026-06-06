import { randomUUID } from "node:crypto";
import type { PeerInfo, RoomSummary } from "@bridge-packet/shared";
import { ErrorCode } from "@bridge-packet/shared";
import type { WebSocket } from "ws";
import { AppError } from "../../lib/errors.js";
import { PeerSession } from "../peer/peer-session.js";
import { RoomStore } from "./room-store.js";

export class RoomService {
  private readonly store = new RoomStore();
  private readonly sessions = new Map<string, PeerSession>();
  private readonly socketToPeer = new WeakMap<WebSocket, string>();

  createRoom(roomId?: string): RoomSummary {
    try {
      const room = this.store.create(roomId);
      return this.toSummary(room);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Room already exists")) {
        throw new AppError(ErrorCode.INTERNAL_ERROR, error.message);
      }
      throw error;
    }
  }

  getRoom(roomId: string): RoomSummary {
    const room = this.store.get(roomId);
    if (!room) {
      throw new AppError(ErrorCode.ROOM_NOT_FOUND, `Room not found: ${roomId}`);
    }
    return this.toSummary(room);
  }

  listRooms(): RoomSummary[] {
    return this.store.list().map((room) => this.toSummary(room));
  }

  joinRoom(roomId: string, displayName: string, socket: WebSocket): PeerSession {
    const room = this.store.getOrCreate(roomId);
    const peerId = randomUUID();
    const session = new PeerSession(peerId, displayName, socket);

    session.roomId = roomId;
    room.peers.set(peerId, { peerId, displayName });
    this.sessions.set(peerId, session);
    this.socketToPeer.set(socket, peerId);

    return session;
  }

  leavePeer(peerId: string): { roomId: string; peers: PeerInfo[] } | null {
    const session = this.sessions.get(peerId);
    if (!session?.roomId) {
      return null;
    }

    const roomId = session.roomId;
    const room = this.store.get(roomId);
    if (room) {
      room.peers.delete(peerId);
      if (room.peers.size === 0) {
        this.store.delete(roomId);
      }
    }

    this.sessions.delete(peerId);
    session.roomId = null;

    const remainingPeers = room ? [...room.peers.values()] : [];
    return { roomId, peers: remainingPeers };
  }

  leaveBySocket(socket: WebSocket): { peerId: string; roomId: string } | null {
    const peerId = this.socketToPeer.get(socket);
    if (!peerId) {
      return null;
    }

    const session = this.sessions.get(peerId);
    const roomId = session?.roomId;
    this.leavePeer(peerId);

    return roomId ? { peerId, roomId } : null;
  }

  getSession(peerId: string): PeerSession {
    const session = this.sessions.get(peerId);
    if (!session) {
      throw new AppError(ErrorCode.PEER_NOT_FOUND, `Peer not found: ${peerId}`);
    }
    return session;
  }

  getSessionBySocket(socket: WebSocket): PeerSession {
    const peerId = this.socketToPeer.get(socket);
    if (!peerId) {
      throw new AppError(ErrorCode.PEER_NOT_FOUND, "Peer session not established");
    }
    return this.getSession(peerId);
  }

  getPeersInRoom(roomId: string): PeerInfo[] {
    const room = this.store.get(roomId);
    if (!room) {
      return [];
    }
    return [...room.peers.values()];
  }

  broadcast(roomId: string, message: unknown, excludePeerId?: string): void {
    const room = this.store.get(roomId);
    if (!room) {
      return;
    }

    for (const { peerId } of room.peers.values()) {
      if (peerId === excludePeerId) {
        continue;
      }
      this.sessions.get(peerId)?.send(message);
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      void session.closeMedia();
    }
    this.sessions.clear();
    for (const roomId of this.store.list().map((room) => room.roomId)) {
      this.store.delete(roomId);
    }
  }

  private toSummary(room: { roomId: string; createdAt: Date; peers: Map<string, PeerInfo> }): RoomSummary {
    return {
      roomId: room.roomId,
      peerCount: room.peers.size,
      createdAt: room.createdAt.toISOString(),
    };
  }
}
