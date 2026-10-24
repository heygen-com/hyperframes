import { describe, expect, it } from "vitest";
import { alphaDecoderFor, pixelFormatHasAlpha, videoStreamHasAlpha } from "./mediaAlpha.js";

describe("pixelFormatHasAlpha", () => {
  const ALPHA = [
    "yuva420p",
    "yuva444p10le",
    "yuva444p12le",
    "rgba",
    "argb",
    "bgra",
    "abgr",
    "gbrap",
    "gbrap12le",
    "ya8",
    "ya16le",
    "ayuv64le",
    "YUVA420P",
  ];
  const OPAQUE = [
    "yuv420p",
    "yuv422p10le",
    "yuv444p10le",
    "rgb24",
    "gray",
    "gbrp",
    "nv12",
    "bgr0",
    "rgb0",
  ];

  it.each(ALPHA)("detects alpha in %s", (fmt) => expect(pixelFormatHasAlpha(fmt)).toBe(true));
  it.each(OPAQUE)("reports %s as opaque", (fmt) => expect(pixelFormatHasAlpha(fmt)).toBe(false));
  it("reports a missing pix_fmt as opaque", () =>
    expect(pixelFormatHasAlpha(undefined)).toBe(false));
});

describe("videoStreamHasAlpha", () => {
  // ffprobe 8.1 on a libvpx-vp9 yuva420p encode: the alpha lives only in the tag.
  const vp9Alpha = { codec_name: "vp9", pix_fmt: "yuv420p", tags: { ALPHA_MODE: "1" } };

  it("reads the VP8/VP9 alpha_mode tag in any casing", () => {
    expect(videoStreamHasAlpha(vp9Alpha)).toBe(true);
    expect(videoStreamHasAlpha({ pix_fmt: "yuv420p", tags: { alpha_mode: "1" } })).toBe(true);
  });

  it("reads an alpha pix_fmt with no tag", () => {
    expect(videoStreamHasAlpha({ pix_fmt: "yuva444p10le" })).toBe(true);
  });

  it("reports opaque streams", () => {
    expect(videoStreamHasAlpha({ pix_fmt: "yuv420p" })).toBe(false);
    expect(videoStreamHasAlpha({ pix_fmt: "yuv420p", tags: { ALPHA_MODE: "0" } })).toBe(false);
    expect(videoStreamHasAlpha({ pix_fmt: "yuv420p", tags: { ENCODER: "Lavc" } })).toBe(false);
  });
});

describe("alphaDecoderFor", () => {
  it("picks the libvpx decoders that read the alpha side channel", () => {
    expect(alphaDecoderFor("vp9")).toBe("libvpx-vp9");
    expect(alphaDecoderFor("VP9")).toBe("libvpx-vp9");
    expect(alphaDecoderFor("vp8")).toBe("libvpx");
  });

  it("leaves other codecs on ffmpeg's default decoder", () => {
    expect(alphaDecoderFor("prores")).toBeNull();
    expect(alphaDecoderFor("h264")).toBeNull();
    expect(alphaDecoderFor(undefined)).toBeNull();
  });
});
