import { randomUUID } from "node:crypto";
import type { PeerInfo } from "@packet-bridge/shared";

export interface RoomRecord {
  roomId: string;
  createdAt: Date;
  peers: Map<string, PeerInfo>;
}

export class RoomStore {
  private readonly rooms = new Map<string, RoomRecord>();

  create(roomId?: string): RoomRecord {
    const id = roomId ?? randomUUID();
    if (this.rooms.has(id)) {
      throw new Error(`Room already exists: ${id}`);
    }

    const room: RoomRecord = {
      roomId: id,
      createdAt: new Date(),
      peers: new Map(),
    };

    this.rooms.set(id, room);
    return room;
  }

  get(roomId: string): RoomRecord | undefined {
    return this.rooms.get(roomId);
  }

  getOrCreate(roomId: string): RoomRecord {
    const existing = this.rooms.get(roomId);
    if (existing) {
      return existing;
    }

    return this.create(roomId);
  }

  delete(roomId: string): void {
    this.rooms.delete(roomId);
  }

  list(): RoomRecord[] {
    return [...this.rooms.values()];
  }
}
