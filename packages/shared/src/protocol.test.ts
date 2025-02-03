import { describe, expect, it } from "vitest";
import { clientMessageSchema } from "./protocol.js";

describe("clientMessageSchema", () => {
  it("validates room.join message", () => {
    const result = clientMessageSchema.safeParse({
      type: "room.join",
      requestId: "req-1",
      payload: { roomId: "room-a", displayName: "Alice" },
    });

    expect(result.success).toBe(true);
  });

  it("rejects room.join with empty displayName", () => {
    const result = clientMessageSchema.safeParse({
      type: "room.join",
      payload: { roomId: "room-a", displayName: "" },
    });

    expect(result.success).toBe(false);
  });

  it("validates media.createWebRtcTransport message", () => {
    const result = clientMessageSchema.safeParse({
      type: "media.createWebRtcTransport",
      payload: { direction: "sendrecv" },
    });

    expect(result.success).toBe(true);
  });
});
