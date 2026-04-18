import { describe, it, expect } from "vitest";
import { isFontResourceError } from "./frameCapture.js";

describe("isFontResourceError", () => {
  it("matches Google Fonts CSS load failures via location.url", () => {
    expect(
      isFontResourceError(
        "error",
        "Failed to load resource: net::ERR_FAILED",
        "https://fonts.googleapis.com/css2?family=Inter",
      ),
    ).toBe(true);
  });

  it("matches gstatic font binaries via location.url", () => {
    expect(
      isFontResourceError(
        "error",
        "Failed to load resource: the server responded with a status of 404 (Not Found)",
        "https://fonts.gstatic.com/s/inter/v12/foo.woff2",
      ),
    ).toBe(true);
  });

  it("matches self-hosted woff2 failures", () => {
    expect(
      isFontResourceError(
        "error",
        "Failed to load resource: net::ERR_CONNECTION_REFUSED",
        "http://localhost:9999/font.woff2",
      ),
    ).toBe(true);
  });

  it("matches .ttf and .otf URLs", () => {
    expect(
      isFontResourceError("error", "Failed to load resource: 404", "http://example.com/a.ttf"),
    ).toBe(true);
    expect(
      isFontResourceError("error", "Failed to load resource: 404", "http://example.com/b.otf"),
    ).toBe(true);
  });

  it("does NOT match non-font resources (images, scripts, videos)", () => {
    expect(
      isFontResourceError("error", "Failed to load resource: 404", "https://example.com/img.png"),
    ).toBe(false);
    expect(
      isFontResourceError(
        "error",
        "Failed to load resource: 404",
        "https://cdn.example.com/bundle.js",
      ),
    ).toBe(false);
    expect(
      isFontResourceError("error", "Failed to load resource: 404", "https://example.com/video.mp4"),
    ).toBe(false);
  });

  it("does NOT match when location.url is missing and text has no URL (safe default)", () => {
    expect(isFontResourceError("error", "Failed to load resource: 404", "")).toBe(false);
  });

  it("still matches when URL appears in text (older Chrome formats)", () => {
    expect(
      isFontResourceError(
        "error",
        "Failed to load resource: https://fonts.googleapis.com/... 404",
        "",
      ),
    ).toBe(true);
  });

  it("does NOT match non-error console messages", () => {
    expect(
      isFontResourceError(
        "warn",
        "Failed to load resource: 404",
        "https://fonts.googleapis.com/css2",
      ),
    ).toBe(false);
    expect(
      isFontResourceError(
        "info",
        "Failed to load resource: 404",
        "https://fonts.googleapis.com/css2",
      ),
    ).toBe(false);
  });

  it("does NOT match unrelated error messages", () => {
    expect(isFontResourceError("error", "Uncaught ReferenceError: x is not defined", "")).toBe(
      false,
    );
    expect(
      isFontResourceError("error", "Some other error", "https://fonts.googleapis.com/css2"),
    ).toBe(false);
  });

  it("is case-insensitive for URL matching", () => {
    expect(
      isFontResourceError(
        "error",
        "Failed to load resource: 404",
        "https://FONTS.GOOGLEAPIS.COM/css2",
      ),
    ).toBe(true);
    expect(
      isFontResourceError("error", "Failed to load resource: 404", "http://example.com/FONT.WOFF2"),
    ).toBe(true);
  });
});
