import { describe, expect, it } from "vitest";
import { ErrorCode } from "@packet-bridge/shared";
import { AppError } from "../lib/errors.js";
import { createPeerLimits } from "./peer-limits.js";
import { PolicyViolationCode } from "./types.js";

describe("PeerLimits", () => {
  const limits = createPeerLimits({
    maxTransportsPerPeer: 2,
    maxProducersPerPeer: 1,
    maxConsumersPerPeer: 2,
    maxJoinAttemptsPerMinute: 2,
  });

  it("tracks peer usage lifecycle", () => {
    const snapshot = limits.trackPeer("peer-1");
    expect(snapshot.peerId).toBe("peer-1");
    limits.untrackPeer("peer-1");
    expect(limits.getUsage("peer-1").transports).toBe(0);
  });

  it("enforces transport limits", () => {
    expect(limits.incrementTransports("peer-1").allowed).toBe(true);
    expect(limits.incrementTransports("peer-1").allowed).toBe(true);
    const denied = limits.incrementTransports("peer-1");
    expect(denied.allowed).toBe(false);
    expect(denied.violation?.code).toBe(PolicyViolationCode.TRANSPORT_LIMIT_EXCEEDED);

    limits.decrementTransports("peer-1");
    expect(limits.getUsage("peer-1").transports).toBe(1);
  });

  it("enforces producer and consumer limits", () => {
    expect(limits.incrementProducers("peer-2").allowed).toBe(true);
    expect(limits.incrementProducers("peer-2").allowed).toBe(false);
    limits.decrementProducers("peer-2");

    expect(limits.incrementConsumers("peer-2").allowed).toBe(true);
    expect(limits.incrementConsumers("peer-2").allowed).toBe(true);
    expect(limits.incrementConsumers("peer-2").allowed).toBe(false);
    limits.decrementConsumers("peer-2");
  });

  it("limits join attempts per minute", () => {
    const now = 1_000_000;
    expect(limits.recordJoinAttempt("peer-3", now).allowed).toBe(true);
    expect(limits.recordJoinAttempt("peer-3", now + 1000).allowed).toBe(true);
    const denied = limits.recordJoinAttempt("peer-3", now + 2000);
    expect(denied.allowed).toBe(false);
    expect(denied.violation?.code).toBe(PolicyViolationCode.PEER_LIMIT_EXCEEDED);

    expect(limits.recordJoinAttempt("peer-3", now + 70_000).allowed).toBe(true);
  });

  it("assertAllowed throws AppError on violation", () => {
    limits.incrementProducers("peer-4");
    expect(() => limits.assertAllowed(limits.incrementProducers("peer-4"))).toThrow(AppError);
    try {
      limits.assertAllowed(limits.incrementProducers("peer-4"));
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.INVALID_MESSAGE);
    }
  });

  it("reset clears one or all peers", () => {
    const isolated = createPeerLimits();
    isolated.incrementTransports("peer-5");
    isolated.reset("peer-5");
    expect(isolated.size()).toBe(0);

    isolated.incrementTransports("peer-6");
    isolated.reset();
    expect(isolated.size()).toBe(0);
  });
});
