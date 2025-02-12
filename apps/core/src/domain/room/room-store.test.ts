import { describe, expect, it } from "vitest";
import { RoomStore } from "./room-store.js";

describe("RoomStore", () => {
  it("tracks room count", () => {
    const store = new RoomStore();
    expect(store.count()).toBe(0);

    store.create("room-a");
    store.create("room-b");

    expect(store.count()).toBe(2);
  });

  it("deletes rooms by id", () => {
    const store = new RoomStore();
    store.create("room-a");
    store.delete("room-a");

    expect(store.count()).toBe(0);
    expect(store.get("room-a")).toBeUndefined();
  });

  it("creates a room with generated id", () => {
    const store = new RoomStore();
    const room = store.create();
    expect(room.roomId).toBeTruthy();
  });

  it("throws when creating duplicate room", () => {
    const store = new RoomStore();
    store.create("room-a");
    expect(() => store.create("room-a")).toThrow("Room already exists");
  });

  it("returns existing room from getOrCreate", () => {
    const store = new RoomStore();
    const created = store.create("room-a");
    const fetched = store.getOrCreate("room-a");
    expect(fetched).toBe(created);
  });
});
