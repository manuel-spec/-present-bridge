import { describe, expect, it } from "vitest";
import { ErrorCode } from "./errors.js";

describe("ErrorCode", () => {
  it("includes media and room error codes", () => {
    expect(ErrorCode.ROOM_NOT_FOUND).toBe("ROOM_NOT_FOUND");
    expect(ErrorCode.MEDIA_ERROR).toBe("MEDIA_ERROR");
    expect(ErrorCode.TRANSPORT_NOT_FOUND).toBe("TRANSPORT_NOT_FOUND");
  });
});
