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
    expect(classifyScriptLoadCause(url, SERVER, failure)).toEqual({ origin, code });
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
});
