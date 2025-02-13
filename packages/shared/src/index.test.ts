import { describe, expect, it } from "vitest";
import { APP_VERSION, WS_PATH, ErrorCode } from "./index.js";

describe("shared index exports", () => {
  it("re-exports constants and error codes", () => {
    expect(WS_PATH).toBe("/ws");
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ErrorCode.ROOM_NOT_FOUND).toBe("ROOM_NOT_FOUND");
  });
});
