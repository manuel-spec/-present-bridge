import { describe, expect, it } from "vitest";
import { mediaCodecs } from "./codecs.js";

describe("mediaCodecs", () => {
  it("includes opus audio and VP8 video", () => {
    expect(mediaCodecs).toHaveLength(2);
    expect(mediaCodecs[0]?.mimeType).toBe("audio/opus");
    expect(mediaCodecs[1]?.mimeType).toBe("video/VP8");
  });
});
