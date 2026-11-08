import { describe, expect, it, vi } from "vitest";
import type { CaptureSession } from "./frameCapture.js";
import { classifyScriptLoadCause, recordSubTimelineWarning } from "./frameCapture.js";

const SERVER = "http://localhost:4100";

describe("classifyScriptLoadCause", () => {
  it.each([
    [`${SERVER}/scene.js`, "net::ERR_CONNECTION_RESET", "local", "net::ERR_CONNECTION_RESET"],
    [`${SERVER}/scene.js`, 404, "local", "http-404"],
    [
      "https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js",
      "net::ERR_ABORTED",
      "cdn",
      "net::ERR_ABORTED",
    ],
    ["https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js", 503, "cdn", "http-503"],
    [
      "https://assets.example.test/lib.js",
      "net::ERR_NAME_NOT_RESOLVED",
      "remote",
      "net::ERR_NAME_NOT_RESOLVED",
    ],
    ["runtime-error:subresource-integrity", "unknown", "unknown", "unknown"],
    [`${SERVER}/a.js`, "something the browser worded freely: /Users/me/x.js", "local", "unknown"],
  ] as const)("%s + %s", (url, failure, origin, code) => {
    expect(classifyScriptLoadCause(url, SERVER, failure)).toMatchObject({ origin, code });
  });

  // fails without the fix: a report said a CDN script failed but never which library.
  it.each([
    ["https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js", "gsap@3.14.2"],
    ["https://unpkg.com/three@0.147.0/build/three.min.js", "three@0.147.0"],
    ["https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js", "lottie-web@5.12.2"],
    ["https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js", undefined],
    ["https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.2.8/x.css", undefined],
    ["https://assets.example.test/gsap@3.14.2/gsap.js", undefined],
    ["https://cdn.jsdelivr.net/npm/gsap@3.14.2/../../evil@1.0.0/x.js", undefined],
  ] as const)("names the library of %s as %s", (url, lib) => {
    expect(classifyScriptLoadCause(url, SERVER, "net::ERR_INTERNET_DISCONNECTED").lib).toBe(lib);
  });
});

describe("the script-failure warning", () => {
  it("names the closed origin and code of each failed script before the free text, so a cut message keeps them", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = {
      subTimelineWaitOutcome: "script_failure",
      scriptLoadFailures: [`${SERVER}/scene.js`, "https://cdn.jsdelivr.net/npm/gsap.js"],
      scriptLoadCauses: [
        { origin: "local", code: "net::ERR_CONNECTION_RESET" },
        { origin: "cdn", code: "http-503" },
      ],
      pageErrors: ["runtime-error:TypeError: " + "x".repeat(600)],
      warnings: [],
    } as unknown as CaptureSession;
    recordSubTimelineWarning(session, 45_000);
    const [warning] = session.warnings;
    expect(
      warning.message.startsWith(
        "A sub-composition timeline script failed to load [script_load: local/net::ERR_CONNECTION_RESET, cdn/http-503] (",
      ),
    ).toBe(true);
  });

  it("names the failed libraries in a bracket of their own, after the first one", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = {
      subTimelineWaitOutcome: "script_failure",
      scriptLoadFailures: ["https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"],
      scriptLoadCauses: [
        { origin: "cdn", code: "net::ERR_INTERNET_DISCONNECTED", lib: "gsap@3.14.2" },
      ],
      pageErrors: [],
      warnings: [],
    } as unknown as CaptureSession;
    recordSubTimelineWarning(session, 45_000);
    expect(session.warnings[0].message).toContain(
      "[script_load: cdn/net::ERR_INTERNET_DISCONNECTED] [script_lib: gsap@3.14.2] (",
    );
  });
});
