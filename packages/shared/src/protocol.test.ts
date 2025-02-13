import { describe, expect, it } from "vitest";
import {
  clientMessageSchema,
  mediaKindSchema,
  peerInfoSchema,
  roomJoinPayloadSchema,
  transportDirectionSchema,
} from "./protocol.js";

describe("transportDirectionSchema", () => {
  it("accepts valid directions", () => {
    for (const direction of ["send", "recv", "sendrecv"] as const) {
      expect(transportDirectionSchema.safeParse(direction).success).toBe(true);
    }
  });
});

describe("mediaKindSchema", () => {
  it("accepts audio and video", () => {
    expect(mediaKindSchema.safeParse("audio").success).toBe(true);
    expect(mediaKindSchema.safeParse("video").success).toBe(true);
    expect(mediaKindSchema.safeParse("screen").success).toBe(false);
  });
});

describe("peerInfoSchema", () => {
  it("requires peerId and displayName", () => {
    expect(peerInfoSchema.safeParse({ peerId: "p1", displayName: "A" }).success).toBe(true);
    expect(peerInfoSchema.safeParse({ peerId: "p1" }).success).toBe(false);
  });
});

describe("roomJoinPayloadSchema", () => {
  it("rejects empty room id and long display names", () => {
    expect(roomJoinPayloadSchema.safeParse({ roomId: "", displayName: "A" }).success).toBe(false);
    expect(
      roomJoinPayloadSchema.safeParse({ roomId: "room", displayName: "x".repeat(65) }).success,
    ).toBe(false);
  });
});

describe("clientMessageSchema", () => {
  it("validates all supported client message types", () => {
    const messages = [
      { type: "room.join", payload: { roomId: "room-a", displayName: "Alice" } },
      { type: "room.leave", payload: {} },
      { type: "media.getRouterRtpCapabilities", payload: {} },
      { type: "media.createWebRtcTransport", payload: { direction: "send" } },
      {
        type: "media.connectWebRtcTransport",
        payload: { transportId: "t1", dtlsParameters: {} },
      },
      {
        type: "media.produce",
        payload: { transportId: "t1", kind: "audio", rtpParameters: {} },
      },
      {
        type: "media.consume",
        payload: { transportId: "t1", producerId: "p1", rtpCapabilities: {} },
      },
      { type: "media.resumeConsumer", payload: { consumerId: "c1" } },
    ];

    for (const message of messages) {
      expect(clientMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it("rejects invalid produce kind", () => {
    const result = clientMessageSchema.safeParse({
      type: "media.produce",
      payload: { transportId: "t1", kind: "screen", rtpParameters: {} },
    });
    expect(result.success).toBe(false);
  });
});
