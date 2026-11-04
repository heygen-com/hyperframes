import { describe, expect, it } from "vitest";
import { resolveInPageEncode, type InPageEncodeInput } from "./inPageEncodeEligibility.js";

const ready: InPageEncodeInput = {
  enabled: true,
  captureMode: "drawelement",
  format: "mp4",
  codec: "h264",
  hdr: false,
  transparent: false,
  workers: 1,
  hls: false,
  videoLayer: false,
  encoderSupported: true,
};

describe("resolveInPageEncode", () => {
  it("takes a plain h264 mp4 drawElement film", () => {
    expect(resolveInPageEncode(ready)).toEqual({ eligible: true });
  });

  it.each([
    [{ enabled: false }, "disabled"],
    [{ captureMode: "screenshot" as const }, "capture is not drawElement"],
    [{ format: "webm" }, "output is not mp4"],
    [{ codec: "h265" }, "codec is not h264"],
    [{ hdr: true }, "hdr"],
    [{ transparent: true }, "transparent"],
    [{ workers: 3 }, "parallel workers"],
    [{ hls: true }, "hls"],
    [{ videoLayer: true }, "video layer passthrough"],
    [{ encoderSupported: false }, "page encoder unsupported"],
  ])("leaves %j to today's path: %s", (change, reason) => {
    expect(resolveInPageEncode({ ...ready, ...change })).toEqual({ eligible: false, reason });
  });
});
