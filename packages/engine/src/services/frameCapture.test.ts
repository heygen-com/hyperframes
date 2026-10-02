import { describe, it, expect } from "vitest";
import {
  buildZeroDurationDiagnostic,
  classifyConsoleScriptFailure,
  DrawElementVerificationError,
  formatHttpErrorDiagnostic,
  formatConsoleDiagnostic,
  formatNavigationFailureDiagnostic,
  formatNavigationStartDiagnostic,
  formatRequestFailureDiagnostic,
  HF_READY_DIAGNOSTIC_EXPR,
  getDrawElementVerificationDetails,
  isFontResourceError,
  isDrawElementVerificationError,
  sanitizeDiagnosticUrl,
  shouldIgnoreRequestFailureDiagnostic,
} from "./frameCapture.js";

describe("classifyConsoleScriptFailure", () => {
  it("promotes Chromium's blocked subresource-integrity diagnostic", () => {
    expect(
      classifyConsoleScriptFailure(
        "error",
        "Failed to find a valid digest in the 'integrity' attribute for resource 'http://127.0.0.1:4173/_ext/vendor/gsap.js' with computed SHA-384 integrity 'abc'. The resource has been blocked.",
      ),
    ).toBe("runtime-error:subresource-integrity");
  });

  it("ignores non-error and unrelated integrity messages", () => {
    expect(
      classifyConsoleScriptFailure(
        "warning",
        "Failed to find a valid digest in the 'integrity' attribute. The resource has been blocked.",
      ),
    ).toBeNull();
    expect(classifyConsoleScriptFailure("error", "Integrity metadata is present.")).toBeNull();
  });
});

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
      formatConsoleDiagnostic("info", '[hyperframes] render runtime fps {"canonicalFps":30}', ""),
    ).toEqual({
      text: '[HyperFrames] render runtime fps {"canonicalFps":30}',
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

  it("ignores benign media aborts without hiding real request failures", () => {
    expect(
      shouldIgnoreRequestFailureDiagnostic({
        resourceType: "media",
        url: "http://127.0.0.1:4173/assets/video.mp4",
        failureText: "net::ERR_ABORTED",
      }),
    ).toBe(true);
    expect(
      shouldIgnoreRequestFailureDiagnostic({
        resourceType: "other",
        url: "http://127.0.0.1:4173/assets/audio.oga?cache=1",
        failureText: "net::ERR_ABORTED",
      }),
    ).toBe(true);
    expect(
      shouldIgnoreRequestFailureDiagnostic({
        resourceType: "media",
        url: "http://127.0.0.1:4173/assets/video.mp4",
        failureText: "net::ERR_FAILED",
      }),
    ).toBe(false);
    expect(
      shouldIgnoreRequestFailureDiagnostic({
        resourceType: "script",
        url: "http://127.0.0.1:4173/assets/app.js",
        failureText: "net::ERR_ABORTED",
      }),
    ).toBe(false);
  });
});

describe("DrawElementVerificationError details", () => {
  it("carries frameIndex/failedDb/verifyThresholdDb when provided", () => {
    const err = new DrawElementVerificationError("drawElement self-verify failed at frame 649", {
      kind: "psnr",
      frameIndex: 649,
      failedDb: 28.4,
      verifyThresholdDb: 32,
    });
    expect(isDrawElementVerificationError(err)).toBe(true);
    expect(getDrawElementVerificationDetails(err)).toEqual({
      kind: "psnr",
      frameIndex: 649,
      failedDb: 28.4,
      verifyThresholdDb: 32,
    });
  });

  it("omits fields that weren't supplied (blank-frame throws have no dB)", () => {
    const err = new DrawElementVerificationError("blank drawElement frame 12", {
      kind: "blank",
      frameIndex: 12,
    });
    expect(getDrawElementVerificationDetails(err)).toEqual({ kind: "blank", frameIndex: 12 });
  });

  it("returns undefined for a non-verification error", () => {
    expect(getDrawElementVerificationDetails(new Error("boring"))).toBeUndefined();
  });

  it("finds details through a wrapping cause chain (producer's CaptureStageError)", () => {
    const inner = new DrawElementVerificationError("psnr breach", {
      kind: "psnr",
      frameIndex: 5,
      failedDb: 12.1,
    });
    const wrapper = new Error("capture stage failed", { cause: inner });
    expect(isDrawElementVerificationError(wrapper)).toBe(true);
    expect(getDrawElementVerificationDetails(wrapper)).toEqual({
      kind: "psnr",
      frameIndex: 5,
      failedDb: 12.1,
    });
  });

  it("carries kind='blank'/'psnr' as a structural field, not derived from message text", () => {
    const blankErr = new DrawElementVerificationError("blank drawElement frame 12", {
      kind: "blank",
      frameIndex: 12,
    });
    const psnrErr = new DrawElementVerificationError(
      "drawElement self-verify failed at frame 649",
      { kind: "psnr", frameIndex: 649, failedDb: 28.4, verifyThresholdDb: 32 },
    );
    expect(getDrawElementVerificationDetails(blankErr)?.kind).toBe("blank");
    expect(getDrawElementVerificationDetails(psnrErr)?.kind).toBe("psnr");
  });

  it("kind survives even when the message text disagrees with (or omits) the word psnr/blank", () => {
    // A reworded message that says neither "blank" nor "psnr" — a regex over
    // message text would have no signal here; the structural kind must still
    // report correctly.
    const reworded = new DrawElementVerificationError("frame 12 failed verification", {
      kind: "blank",
      frameIndex: 12,
    });
    expect(getDrawElementVerificationDetails(reworded)?.kind).toBe("blank");

    // Adversarial: a psnr failure whose message happens to mention "blank"
    // (e.g. quoting a neighboring log line) — the structural kind must not
    // flip just because the substring "blank" appears in the text.
    const adversarial = new DrawElementVerificationError(
      "drawElement self-verify failed at frame 5 (previous frame was blank-guard-accepted)",
      { kind: "psnr", frameIndex: 5, failedDb: 12.1, verifyThresholdDb: 32 },
    );
    expect(getDrawElementVerificationDetails(adversarial)?.kind).toBe("psnr");
  });
});

describe("buildZeroDurationDiagnostic", () => {
  const baseDiag = {
    renderReady: false,
    hasHf: true,
    hasSeek: true,
    hasPlayer: true,
    duration: 0,
    hasTimeline: true,
    declaredDuration: 6,
    pendingBuildReadyKeys: [] as string[],
    rejectedBuildReadyKeys: [] as string[],
  };

  it("names the stuck buildReady key instead of blaming GSAP/data-duration", () => {
    const message = buildZeroDurationDiagnostic({
      ...baseDiag,
      pendingBuildReadyKeys: ["heavy-mesh"],
    });
    expect(message).toContain("window.__hf.buildReady never resolved for: heavy-mesh");
  });

  it("lists every stuck key when more than one is pending", () => {
    const message = buildZeroDurationDiagnostic({
      ...baseDiag,
      pendingBuildReadyKeys: ["heavy-mesh", "shader-warmup"],
    });
    expect(message).toContain(
      "window.__hf.buildReady never resolved for: heavy-mesh, shader-warmup",
    );
  });

  it("omits the buildReady hint entirely when nothing is pending or rejected", () => {
    const message = buildZeroDurationDiagnostic(baseDiag);
    expect(message).not.toContain("buildReady");
  });

  it("names a rejected buildReady key separately from a pending one", () => {
    const message = buildZeroDurationDiagnostic({
      ...baseDiag,
      pendingBuildReadyKeys: ["heavy-mesh"],
      rejectedBuildReadyKeys: ["shader-warmup"],
    });
    expect(message).toContain("window.__hf.buildReady never resolved for: heavy-mesh");
    expect(message).toContain("window.__hf.buildReady rejected for: shader-warmup");
  });
});

describe("HF_READY_DIAGNOSTIC_EXPR (evaluated as real JS, not via a fake fixture)", () => {
  // The expression is a Puppeteer page.evaluate string, never executed by
  // any other test. Running it here through `new Function` against a fake
  // window/document exercises its actual settle/reject logic in-process.
  async function runDiagnosticExpr(buildReady: Record<string, unknown>): Promise<{
    pendingBuildReadyKeys: string[];
    rejectedBuildReadyKeys: string[];
  }> {
    const fakeWindow = {
      __hf: { seek: () => {}, duration: 0, buildReady },
      __player: {},
      __renderReady: false,
      __timelines: {},
    };
    const fakeDocument = { querySelector: () => null };
    const run = new Function("window", "document", `return ${HF_READY_DIAGNOSTIC_EXPR}`) as (
      win: unknown,
      doc: unknown,
    ) => Promise<{
      pendingBuildReadyKeys: string[];
      rejectedBuildReadyKeys: string[];
    }>;
    return run(fakeWindow, fakeDocument);
  }

  it("does not reject the whole diagnostic when a buildReady entry rejects", async () => {
    const result = await runDiagnosticExpr({ heavy: Promise.reject(new Error("boom")) });
    expect(result.rejectedBuildReadyKeys).toEqual(["heavy"]);
    expect(result.pendingBuildReadyKeys).toEqual([]);
  });

  it("reports a settled non-native thenable as resolved, not pending", async () => {
    const settledThenable = { then: (res: (v: unknown) => void) => res(1) };
    const result = await runDiagnosticExpr({ heavy: settledThenable });
    expect(result.pendingBuildReadyKeys).toEqual([]);
    expect(result.rejectedBuildReadyKeys).toEqual([]);
  });

  it("reports a genuinely pending promise as pending", async () => {
    const result = await runDiagnosticExpr({ heavy: new Promise(() => {}) });
    expect(result.pendingBuildReadyKeys).toEqual(["heavy"]);
    expect(result.rejectedBuildReadyKeys).toEqual([]);
  });

  it("returns empty arrays for a composition with no buildReady registrations", async () => {
    const result = await runDiagnosticExpr({});
    expect(result.pendingBuildReadyKeys).toEqual([]);
    expect(result.rejectedBuildReadyKeys).toEqual([]);
  });
});
