import { describe, expect, it } from "vitest";
import { ErrorCode } from "@bridge-packet/shared";
import { AppError, isAppError, toAppError } from "./errors.js";

describe("AppError", () => {
  it("serialises to payload with optional request id", () => {
    const error = new AppError(ErrorCode.ROOM_NOT_FOUND, "missing", "req-1");
    expect(error.toPayload()).toEqual({
      code: ErrorCode.ROOM_NOT_FOUND,
      message: "missing",
      requestId: "req-1",
    });
  });
});

describe("isAppError", () => {
  it("detects AppError instances", () => {
    expect(isAppError(new AppError(ErrorCode.MEDIA_ERROR, "fail"))).toBe(true);
    expect(isAppError(new Error("fail"))).toBe(false);
  });
});

describe("toAppError", () => {
  it("returns existing AppError unchanged", () => {
    const original = new AppError(ErrorCode.PEER_NOT_FOUND, "gone");
    expect(toAppError(original)).toBe(original);
  });

  it("wraps generic Error", () => {
    const wrapped = toAppError(new Error("boom"), "req-9");
    expect(wrapped.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(wrapped.message).toBe("boom");
    expect(wrapped.requestId).toBe("req-9");
  });

  it("wraps unknown values", () => {
    const wrapped = toAppError(null);
    expect(wrapped.message).toBe("Unknown error");
  });
});
