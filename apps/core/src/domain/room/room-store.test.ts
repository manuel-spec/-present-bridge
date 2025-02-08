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
});
