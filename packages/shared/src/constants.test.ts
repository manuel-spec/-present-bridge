import { describe, expect, it } from "vitest";
import { APP_VERSION, WS_PATH } from "./constants.js";

describe("constants", () => {
  it("defines websocket path", () => {
    expect(WS_PATH).toBe("/ws");
  });

  it("defines semver app version", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
