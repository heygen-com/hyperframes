import { describe, expect, it } from "bun:test";
import { frameFileExtension } from "@hyperframes/engine";
import {
  resolveCaptureImageFormat,
  resolveCaptureJpegQuality,
  resolveCaptureSurface,
} from "./captureImageFormat.js";

describe("resolveCaptureImageFormat", () => {
  it("captures JPEG for an ordinary opaque render", () => {
    expect(resolveCaptureImageFormat({ needsAlpha: false, motionBlur: undefined })).toBe("jpeg");
  });

  it("captures PNG when the output container keeps alpha", () => {
    expect(resolveCaptureImageFormat({ needsAlpha: true, motionBlur: undefined })).toBe("png");
  });

  it("captures PNG for motion blur even when the output needs no alpha", () => {
    // The sub-frame samples are averaged pixel by pixel, so they cannot be JPEG.
    expect(resolveCaptureImageFormat({ needsAlpha: false, motionBlur: {} })).toBe("png");
  });

  it("captures PNG for 4:4:4 output, since Chrome's JPEG is already 4:2:0", () => {
    expect(
      resolveCaptureImageFormat({
        needsAlpha: false,
        motionBlur: undefined,
        chromaSubsampling: "444",
      }),
    ).toBe("png");
    expect(
      resolveCaptureImageFormat({
        needsAlpha: false,
        motionBlur: undefined,
        chromaSubsampling: "420",
      }),
    ).toBe("jpeg");
  });

  it("agrees with the name the capture writer gives a frame", () => {
    // The encoder's input pattern is built from this extension, so a disagreement here is
    // a render that captures frames and then finds none.
    for (const needsAlpha of [false, true]) {
      for (const motionBlur of [undefined, {}]) {
        const format = resolveCaptureImageFormat({ needsAlpha, motionBlur });
        expect(frameFileExtension(format)).toBe(format === "png" ? "png" : "jpg");
      }
    }
  });
});

describe("resolveCaptureSurface", () => {
  const base = { needsAlpha: false, motionBlur: undefined };

  it("keeps the ordinary render on JPEG at the resolved quality with the engine background", () => {
    expect(resolveCaptureSurface(base, "standard")).toEqual({ format: "jpeg", quality: 100 });
    expect(resolveCaptureSurface(base, "draft")).toEqual({ format: "jpeg", quality: 80 });
  });

  it("captures 4:4:4 as opaque PNG so an unstyled page does not turn black", () => {
    expect(resolveCaptureSurface({ ...base, chromaSubsampling: "444" }, "draft")).toEqual({
      format: "png",
      quality: undefined,
      transparentBackground: false,
    });
  });

  it("leaves alpha output and motion blur on the transparent PNG default", () => {
    // No transparentBackground key means the engine falls back to format === "png".
    expect(resolveCaptureSurface({ ...base, needsAlpha: true }, "standard")).toEqual({
      format: "png",
      quality: undefined,
    });
    expect(resolveCaptureSurface({ ...base, motionBlur: {} }, "standard")).toEqual({
      format: "png",
      quality: undefined,
    });
    expect(
      resolveCaptureSurface({ ...base, needsAlpha: true, chromaSubsampling: "444" }, "standard"),
    ).toEqual({ format: "png", quality: undefined });
  });
});

describe("resolveCaptureJpegQuality", () => {
  it("captures standard and high renders at quality 100 so graded colour survives", () => {
    expect(resolveCaptureJpegQuality("standard")).toBe(100);
    expect(resolveCaptureJpegQuality("high")).toBe(100);
  });

  it("keeps draft renders on the smaller, faster frames", () => {
    expect(resolveCaptureJpegQuality("draft")).toBe(80);
  });
});
