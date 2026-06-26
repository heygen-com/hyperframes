import { describe, it, expect } from "vitest";
import {
  formatHttpErrorDiagnostic,
  formatConsoleDiagnostic,
  formatNavigationFailureDiagnostic,
  formatNavigationStartDiagnostic,
  formatRequestFailureDiagnostic,
  isFontResourceError,
  sanitizeDiagnosticUrl,
} from "./frameCapture.js";

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

describe("formatConsoleDiagnostic", () => {
  it("surfaces HyperFrames page logs with a dedicated host prefix", () => {
    expect(
      formatConsoleDiagnostic("info", "[hyperframes] render runtime fps JSHandle@object", ""),
    ).toEqual({
      text: "[HyperFrames] render runtime fps JSHandle@object",
      suppressHostLog: false,
    });
  });

  it("keeps font load errors in diagnostics but suppresses host log noise", () => {
    expect(
      formatConsoleDiagnostic(
        "error",
        "Failed to load resource: net::ERR_FAILED",
        "https://fonts.googleapis.com/css2?family=Inter",
      ),
    ).toEqual({
      text: "[Browser] Failed to load resource: net::ERR_FAILED",
      suppressHostLog: true,
    });
  });

  it("preserves existing browser prefixes for generic logs", () => {
    expect(formatConsoleDiagnostic("warn", "careful", "")).toEqual({
      text: "[Browser:WARN] careful",
      suppressHostLog: false,
    });
  });
});

describe("navigation diagnostics", () => {
  it("redacts credentials, query strings, and fragments from diagnostic URLs", () => {
    expect(
      sanitizeDiagnosticUrl("https://user:pass@example.com/assets/video.mp4?token=secret#frag"),
    ).toBe("https://example.com/assets/video.mp4");
  });

  it("redacts data and blob URLs", () => {
    expect(sanitizeDiagnosticUrl("data:image/png;base64,abc123")).toBe("data:<redacted>");
    expect(sanitizeDiagnosticUrl("blob:https://example.com/abc123")).toBe("blob:<redacted>");
  });

  it("redacts query strings from relative URLs", () => {
    expect(sanitizeDiagnosticUrl("/relative/path.png?token=secret#frag")).toBe(
      "/relative/path.png",
    );
  });

  it("formats page.goto failures with mode, timeout, elapsed time, and sanitized URL", () => {
    const diagnostic = formatNavigationFailureDiagnostic({
      captureMode: "screenshot",
      url: "http://127.0.0.1:4173/index.html?claim_token=secret",
      timeoutMs: 60_000,
      elapsedMs: 60_123,
      error: new Error("Navigation timeout of 60000 ms exceeded"),
    });

    expect(diagnostic).toContain("[FrameCapture:ERROR] page.goto failed");
    expect(diagnostic).toContain("mode=screenshot");
    expect(diagnostic).toContain("timeoutMs=60000");
    expect(diagnostic).toContain("elapsedMs=60123");
    expect(diagnostic).toContain("url=http://127.0.0.1:4173/index.html");
    expect(diagnostic).not.toContain("claim_token");
  });

  it("formats page.goto starts with mode, timeout, and sanitized URL", () => {
    const diagnostic = formatNavigationStartDiagnostic({
      captureMode: "screenshot",
      url: "http://127.0.0.1:4173/index.html?claim_token=secret",
      timeoutMs: 60_000,
    });

    expect(diagnostic).toContain("[FrameCapture:NAV] page.goto start");
    expect(diagnostic).toContain("mode=screenshot");
    expect(diagnostic).toContain("timeoutMs=60000");
    expect(diagnostic).toContain("url=http://127.0.0.1:4173/index.html");
    expect(diagnostic).not.toContain("claim_token");
  });

  it("formats request and HTTP failures with sanitized URLs", () => {
    expect(
      formatRequestFailureDiagnostic({
        method: "GET",
        resourceType: "media",
        url: "https://cdn.example.com/video.mp4?token=secret",
        failureText: "net::ERR_FAILED",
      }),
    ).toBe(
      "[Browser:REQUESTFAILED] GET https://cdn.example.com/video.mp4 resource=media error=net::ERR_FAILED",
    );

    expect(
      formatHttpErrorDiagnostic({
        method: "GET",
        resourceType: "image",
        url: "https://cdn.example.com/frame.png?token=secret",
        status: 403,
        statusText: "Forbidden",
      }),
    ).toBe("[Browser:HTTP403] GET https://cdn.example.com/frame.png resource=image Forbidden");
  });
});
