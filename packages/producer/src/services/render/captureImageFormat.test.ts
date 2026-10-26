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

  it("keeps the ordinary render on opaque JPEG at the resolved quality", () => {
    expect(resolveCaptureSurface(base, "standard")).toEqual({
      format: "jpeg",
      quality: 100,
      transparent: false,
    });
    expect(resolveCaptureSurface(base, "draft")).toEqual({
      format: "jpeg",
      quality: 80,
      transparent: false,
    });
  });

  it("captures 4:4:4 and motion blur as opaque PNG so the page background stays", () => {
    const opaquePng = { format: "png", quality: undefined, transparent: false };
    expect(resolveCaptureSurface({ ...base, chromaSubsampling: "444" }, "draft")).toEqual(
      opaquePng,
    );
    expect(resolveCaptureSurface({ ...base, motionBlur: {} }, "standard")).toEqual(opaquePng);
  });

  it("captures alpha output as transparent PNG", () => {
    const transparentPng = { format: "png", quality: undefined, transparent: true };
    expect(resolveCaptureSurface({ ...base, needsAlpha: true }, "standard")).toEqual(
      transparentPng,
    );
    expect(
      resolveCaptureSurface({ ...base, needsAlpha: true, chromaSubsampling: "444" }, "standard"),
    ).toEqual(transparentPng);
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
