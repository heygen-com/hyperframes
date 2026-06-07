import { describe, expect, it } from "vitest";
import { redactTelemetryString } from "./telemetryRedaction.js";

describe("redactTelemetryString", () => {
  it("redacts macOS, Linux, Windows, file URLs, and URL query strings", () => {
    expect(
      redactTelemetryString(
        [
          "/Users/alice/project/video.mp4",
          "/home/ubuntu/project/video.mp4",
          "/workspace/app/video.mp4",
          "C:\\Users\\Alice\\project\\video.mp4",
          "file:///tmp/render/video.mp4",
          "https://example.com/video.mp4?token=secret",
        ].join(" "),
      ),
    ).toBe("[path] [path] [path] [path] [file-url] https://example.com/video.mp4?…");
  });
});
