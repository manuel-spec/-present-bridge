import { describe, expect, it } from "vitest";
import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import { createPolicyService, createStrictPolicyService } from "./policy-service.js";
import { PolicyViolationCode, createRateLimitKey } from "./types.js";

describe("PolicyService", () => {
  const service = createPolicyService({
    globalRateLimit: { windowMs: 60_000, maxRequests: 2 },
    perIpRateLimit: { windowMs: 60_000, maxRequests: 2 },
    room: { maxPeersPerRoom: 2 },
    peer: { maxTransportsPerPeer: 1 },
  });

  it("validates room names via room policy", () => {
    expect(service.validateRoomName("room-a").allowed).toBe(true);
    expect(service.validateRoomName("admin").allowed).toBe(false);
  });

  it("checks join and create room policies", () => {
    expect(
      service.canJoinRoom({ roomId: "room-a", currentPeerCount: 0, isNewRoom: false }).allowed,
    ).toBe(true);
    expect(
      service.canJoinRoom({ roomId: "room-a", currentPeerCount: 2, isNewRoom: false }).allowed,
    ).toBe(false);
  });

  it("enforces global and ip rate limits", () => {
    expect(service.checkGlobalRateLimit("client", 0).allowed).toBe(true);
    expect(service.checkGlobalRateLimit("client", 1).allowed).toBe(true);
    expect(service.checkGlobalRateLimit("client", 2).allowed).toBe(false);

    expect(service.checkIpRateLimit("10.0.0.1", 0).allowed).toBe(true);
    expect(service.checkIpRateLimit("10.0.0.1", 1).allowed).toBe(true);
    expect(() => service.enforceIpRateLimit("10.0.0.1", 2)).toThrow(AppError);
  });

  it("enforceRateLimit throws with retry context", () => {
    service.enforceRateLimit(createRateLimitKey("global", "x"), 0);
    service.enforceRateLimit(createRateLimitKey("global", "x"), 1);
    try {
      service.enforceRateLimit(createRateLimitKey("global", "x"), 2);
      expect.unreachable("should throw");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.INVALID_MESSAGE);
      expect((error as AppError).message).toContain("Rate limit exceeded");
    }
  });

  it("tracks producer and consumer resources", () => {
    service.trackPeer("media-peer");
    expect(service.addProducer("media-peer").allowed).toBe(true);
    expect(service.addConsumer("media-peer").allowed).toBe(true);
    service.removeProducer("media-peer");
    service.removeConsumer("media-peer");
    expect(service.getPeerUsage("media-peer").producers).toBe(0);
    expect(service.getPeerUsage("media-peer").consumers).toBe(0);
  });

  it("records join attempts for peers", () => {
    expect(service.recordJoinAttempt("join-peer").allowed).toBe(true);
  });

  it("tracks peer media resources", () => {
    service.trackPeer("peer-1");
    expect(service.addTransport("peer-1").allowed).toBe(true);
    expect(service.addTransport("peer-1").allowed).toBe(false);
    service.removeTransport("peer-1");
    expect(service.getPeerUsage("peer-1").transports).toBe(0);
  });

  it("assertJoinAllowed validates room and join attempts", () => {
    service.resetPeerLimits();
    service.assertJoinAllowed(
      { roomId: "room-a", currentPeerCount: 0, isNewRoom: false },
      "peer-join",
      0,
    );
    expect(() =>
      service.assertJoinAllowed(
        { roomId: "room-a", currentPeerCount: 99, isNewRoom: false },
        "peer-join",
        1,
      ),
    ).toThrow(AppError);
  });

  it("resets rate and peer limits", () => {
    service.checkGlobalRateLimit("reset-test", 0);
    service.resetRateLimits();
    expect(service.checkGlobalRateLimit("reset-test", 0).allowed).toBe(true);

    service.trackPeer("peer-reset");
    service.resetPeerLimits("peer-reset");
    expect(service.getPeerUsage("peer-reset").transports).toBe(0);
  });

  it("creates strict policy service with tighter limits", () => {
    const strict = createStrictPolicyService();
    expect(strict.getConfig().room.maxPeersPerRoom).toBe(8);
    expect(
      strict.canJoinRoom({ roomId: "room-a", currentPeerCount: 8, isNewRoom: false }).allowed,
    ).toBe(false);
    expect(strict.getConfig().peer.maxTransportsPerPeer).toBe(1);
  });

  it("assertAllowed throws on policy violations", () => {
    expect(() =>
      service.assertAllowed({
        allowed: false,
        violation: {
          code: PolicyViolationCode.ROOM_FULL,
          message: "full",
        },
      }),
    ).toThrow(AppError);
  });

  it("exposes internal policy components", () => {
    expect(service.getRoomPolicy()).toBeTruthy();
    expect(service.getPeerLimits()).toBeTruthy();
    expect(service.getRateLimiter("global")).toBeTruthy();
    expect(service.remainingPeerSlots(1)).toBe(1);
  });
});
