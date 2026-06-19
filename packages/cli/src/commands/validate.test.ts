import { describe, expect, it } from "vitest";
import { shouldIgnoreRequestFailure } from "./validate.js";

describe("shouldIgnoreRequestFailure", () => {
  it("ignores aborted media preload requests", () => {
    expect(
      shouldIgnoreRequestFailure("http://127.0.0.1:3000/assets/sfx.wav", "net::ERR_ABORTED"),
    ).toBe(true);
    expect(shouldIgnoreRequestFailure("http://127.0.0.1:3000/video.mp4", "net::ERR_ABORTED")).toBe(
      true,
    );
    expect(
      shouldIgnoreRequestFailure(
        "https://www.heygenverse.com/s/50f13ccf-9002-4d80-b567-9d4c0eac30d8/raw",
        "net::ERR_ABORTED",
        "media",
      ),
    ).toBe(true);
  });

  it("keeps non-media and non-aborted failures reportable", () => {
    expect(
      shouldIgnoreRequestFailure("http://127.0.0.1:3000/assets/map.png", "net::ERR_ABORTED"),
    ).toBe(false);
    expect(
      shouldIgnoreRequestFailure(
        "https://www.heygenverse.com/s/50f13ccf-9002-4d80-b567-9d4c0eac30d8/raw",
        "net::ERR_ABORTED",
        "xhr",
      ),
    ).toBe(false);
    expect(
      shouldIgnoreRequestFailure("http://127.0.0.1:3000/assets/sfx.wav", "net::ERR_FAILED"),
    ).toBe(false);
  });
});
