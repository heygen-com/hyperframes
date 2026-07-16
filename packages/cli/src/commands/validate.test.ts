import { afterEach, describe, expect, it, vi } from "vitest";
// Imported before "./validate.js" below: validate.js's own static import of
// ../utils/project.js triggers that mocked module's factory as soon as
// validate.js loads, so resolveProjectMock/lintProjectFailureMock must
// already be bound by then (see the vi.mock calls a few lines down).
import {
  lintProjectFailureMock,
  metaDescription,
  resolveProjectMock,
  runAndCaptureStdio,
  runAndParseJsonEnvelope,
} from "./deprecationTestHarness.js";
import {
  auditClipDurations,
  extractCompositionErrorsFromLint,
  navigationTimeoutHint,
  raceMediaReady,
  resolveNavigationTimeoutMs,
  shouldIgnoreRequestFailure,
} from "./validate.js";
import { waitForPreferredSeekTarget } from "../capture/captureCompositionFrame.js";
import type { ProjectLintResult } from "../utils/lintProject.js";

// validateInBrowser lazy-loads the producer localize helpers via loadProducer;
// mock it so these unit tests never resolve @hyperframes/producer's built dist.
vi.mock("../utils/producer.js", () => ({
  loadProducer: vi.fn(async () => ({
    localizeRemoteMediaSources: vi.fn(async (html: string) => ({
      html,
      remoteMediaAssets: new Map(),
    })),
    localizeRemoteImageSources: vi.fn(async (html: string) => ({
      html,
      remoteMediaAssets: new Map(),
    })),
    localizeRemoteFontFaces: vi.fn(async (html: string) => ({
      html,
      remoteMediaAssets: new Map(),
    })),
  })),
}));

// U5 deprecation tests: resolveProject and lintProject are both reached via a
// dynamic `await import(...)` inside validate.ts's run() / validateInBrowser(),
// so vi.mock intercepts them the same way it would a static import. Mocking
// resolveProject skips real filesystem project resolution; mocking lintProject
// (the first await inside validateInBrowser) gives a fast, deterministic
// failure well before any real browser or network work — exercising run()'s
// outer catch (the JSON failure envelope) without needing headless Chrome.
vi.mock("../utils/project.js", () => resolveProjectMock());
vi.mock("../utils/lintProject.js", () => lintProjectFailureMock());

describe("auditClipDurations", () => {
  it("audits audio only because explicit video slots hold their final frame", async () => {
    let selector = "";
    const originalDocument = globalThis.document;
    const audio = {
      duration: 1,
      id: "voice",
      loop: false,
      tagName: "AUDIO",
      getAttribute: (name: string) =>
        name === "data-duration" ? "5" : name === "data-media-start" ? "0" : null,
    };
    const page = {
      evaluate: async (fn: (waitMs: number) => unknown, waitMs: number) => {
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: {
            querySelectorAll: (query: string) => {
              selector = query;
              return [audio];
            },
          },
        });
        return fn(waitMs);
      },
    };

    try {
      const warnings = await auditClipDurations(
        page as never,
        ({ slotSeconds, mediaSeconds }) => ({
          shortfallSeconds: slotSeconds - mediaSeconds,
          toleranceSeconds: 0.05,
        }),
        10,
      );
      expect(selector).toBe("audio[data-duration]");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.text).toContain('Audio "voice"');
    } finally {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, "document");
      } else {
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: originalDocument,
        });
      }
    }
  });
});

// Regression for the validate audio-duration-probe timeout: a slow-loading
// media element's duration was snapshotted once, at a fixed point in time,
// and any element still mid-load was permanently misreported as unreadable.
// raceMediaReady is the extracted wiring auditClipDurations now uses to wait
// for `loadedmetadata` up to a deadline instead. Node's built-in EventTarget
// satisfies the same duck-typed shape as a real HTMLMediaElement here, so
// this is a real test of the race/cleanup logic, not a browser mock.
describe("raceMediaReady", () => {
  class FakeMediaElement extends EventTarget {
    duration = NaN;
  }

  it("resolves immediately when duration is already available", async () => {
    const el = new FakeMediaElement();
    el.duration = 12.5;
    const start = Date.now();
    await raceMediaReady(el, Date.now() + 5000);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("resolves as soon as loadedmetadata fires, before the deadline", async () => {
    const el = new FakeMediaElement();
    const promise = raceMediaReady(el, Date.now() + 5000);
    setTimeout(() => {
      el.duration = 8;
      el.dispatchEvent(new Event("loadedmetadata"));
    }, 20);
    const start = Date.now();
    await promise;
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("resolves on error without hanging until the deadline", async () => {
    const el = new FakeMediaElement();
    const promise = raceMediaReady(el, Date.now() + 5000);
    setTimeout(() => el.dispatchEvent(new Event("error")), 20);
    const start = Date.now();
    await promise;
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("falls back to the deadline when no event ever fires", async () => {
    const el = new FakeMediaElement();
    const start = Date.now();
    await raceMediaReady(el, Date.now() + 50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe("shouldIgnoreRequestFailure", () => {
  it("ignores aborted media preload requests", () => {
    expect(
      shouldIgnoreRequestFailure("http://127.0.0.1:3000/assets/sfx.wav", "net::ERR_ABORTED"),
    ).toBe(true);
    expect(shouldIgnoreRequestFailure("http://127.0.0.1:3000/video.mp4", "net::ERR_ABORTED")).toBe(
      true,
    );
    expect(
      shouldIgnoreRequestFailure(
        "https://www.heygenverse.com/s/50f13ccf-9002-4d80-b567-9d4c0eac30d8/raw",
        "net::ERR_ABORTED",
        "media",
      ),
    ).toBe(true);
  });

  it("keeps non-media and non-aborted failures reportable", () => {
    expect(
      shouldIgnoreRequestFailure("http://127.0.0.1:3000/assets/map.png", "net::ERR_ABORTED"),
    ).toBe(false);
    expect(
      shouldIgnoreRequestFailure(
        "https://www.heygenverse.com/s/50f13ccf-9002-4d80-b567-9d4c0eac30d8/raw",
        "net::ERR_ABORTED",
        "xhr",
      ),
    ).toBe(false);
    expect(
      shouldIgnoreRequestFailure("http://127.0.0.1:3000/assets/sfx.wav", "net::ERR_FAILED"),
    ).toBe(false);
  });
});

describe("waitForPreferredSeekTarget", () => {
  it("waits for the runtime player/bridge target before falling back to raw timelines", async () => {
    const page = {
      waitForFunction: vi.fn(async () => undefined),
    };

    await waitForPreferredSeekTarget(page, 123);

    expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), { timeout: 123 });
  });

  it("does not fail validation when only the legacy raw timeline fallback is available", async () => {
    const page = {
      waitForFunction: vi.fn(async () => {
        throw new Error("waiting failed: timeout");
      }),
    };

    await expect(waitForPreferredSeekTarget(page, 1)).resolves.toBeUndefined();
  });

  it("does not fail validation when the page stub throws synchronously", async () => {
    const page = {
      waitForFunction: vi.fn(() => {
        throw new Error("waiting failed synchronously");
      }),
    };

    await expect(waitForPreferredSeekTarget(page, 1)).resolves.toBeUndefined();
  });
});

describe("extractCompositionErrorsFromLint", () => {
  // `bundleToSingleHtml` (the inliner validate.ts bundles through) is
  // intentionally tolerant of missing/empty/unparsable data-composition-src
  // files — it skips the scene and keeps going, silently, so `validate`
  // would otherwise report "No console errors" for a project that renders a
  // materially broken video. extractCompositionErrorsFromLint pulls the
  // lintProject finding into validate's error list so this is a real
  // validate failure instead.
  function makeLintResult(
    findings: Array<{ code: string; severity: "error" | "warning" | "info"; message: string }>,
  ): Pick<ProjectLintResult, "results"> {
    return {
      results: [
        {
          file: "index.html",
          result: {
            ok: findings.length === 0,
            errorCount: 0,
            warningCount: 0,
            infoCount: 0,
            findings,
          },
        },
      ],
    };
  }

  it("surfaces missing_or_empty_sub_composition errors as ConsoleEntry errors", () => {
    const lintResult = makeLintResult([
      {
        code: "missing_or_empty_sub_composition",
        severity: "error",
        message:
          'data-composition-src references "compositions/scene-title.html", but the file is empty.',
      },
    ]);

    const errors = extractCompositionErrorsFromLint(lintResult);

    expect(errors).toEqual([
      {
        level: "error",
        text: 'data-composition-src references "compositions/scene-title.html", but the file is empty.',
      },
    ]);
  });

  it("ignores unrelated lint finding codes", () => {
    const lintResult = makeLintResult([
      { code: "audio_src_not_found", severity: "error", message: "unrelated" },
      { code: "root_missing_composition_id", severity: "error", message: "also unrelated" },
    ]);

    expect(extractCompositionErrorsFromLint(lintResult)).toEqual([]);
  });

  it("returns an empty array for a clean project", () => {
    expect(extractCompositionErrorsFromLint(makeLintResult([]))).toEqual([]);
  });

  it("collects findings across multiple result files", () => {
    const lintResult: Pick<ProjectLintResult, "results"> = {
      results: [
        {
          file: "index.html",
          result: {
            ok: false,
            errorCount: 1,
            warningCount: 0,
            infoCount: 0,
            findings: [
              {
                code: "missing_or_empty_sub_composition",
                severity: "error",
                message: "scene-a is empty",
              },
            ],
          },
        },
        {
          file: "compositions/nested.html",
          result: {
            ok: false,
            errorCount: 1,
            warningCount: 0,
            infoCount: 0,
            findings: [
              {
                code: "missing_or_empty_sub_composition",
                severity: "error",
                message: "scene-b is empty",
              },
            ],
          },
        },
      ],
    };

    const errors = extractCompositionErrorsFromLint(lintResult);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.text)).toEqual(["scene-a is empty", "scene-b is empty"]);
  });
});

// Regression: `validate` used a hardcoded 10s page-navigation timeout that
// ignored --timeout, so a composition loading GSAP from a CDN <script> (which
// blocks domcontentloaded) failed with an opaque "Navigation timeout of 10000ms"
// even though the full render's larger budget rode it out — with no knob to
// extend it. resolveNavigationTimeoutMs makes --timeout raise the nav budget
// (never below the 10s floor); navigationTimeoutHint replaces the opaque error.
describe("resolveNavigationTimeoutMs", () => {
  it("keeps the 10s floor when --timeout is unset or smaller", () => {
    expect(resolveNavigationTimeoutMs(undefined)).toBe(10000);
    expect(resolveNavigationTimeoutMs(3000)).toBe(10000); // the default --timeout
    expect(resolveNavigationTimeoutMs(0)).toBe(10000);
  });

  it("raises the navigation budget to --timeout when it exceeds the floor", () => {
    expect(resolveNavigationTimeoutMs(30000)).toBe(30000);
  });
});

describe("navigationTimeoutHint", () => {
  it("replaces a Puppeteer navigation-timeout error with an actionable CDN/--timeout hint", () => {
    const hinted = navigationTimeoutHint(
      new Error("Navigation timeout of 10000 ms exceeded"),
      10000,
    );
    expect(hinted).toBeInstanceOf(Error);
    expect(hinted?.message).toContain("10000ms");
    expect(hinted?.message).toContain("CDN");
    expect(hinted?.message).toContain("--timeout");
  });

  it("returns null for any non-navigation-timeout error so the caller rethrows it as-is", () => {
    expect(navigationTimeoutHint(new Error("net::ERR_CONNECTION_REFUSED"), 10000)).toBeNull();
    expect(navigationTimeoutHint("some string failure", 10000)).toBeNull();
  });
});

describe("validate command deprecation (U5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks the command description as deprecated", async () => {
    const { default: validateCommand } = await import("./validate.js");
    expect(metaDescription(validateCommand)).toContain("(deprecated, use check)");
  });

  it("prints a one-line deprecation notice to stderr and never to stdout", async () => {
    const { default: validateCommand } = await import("./validate.js");
    const { stderrText, stdoutText } = await runAndCaptureStdio(validateCommand);
    expect(stderrText).toContain("hyperframes validate");
    expect(stderrText).toContain("hyperframes check");
    expect(stdoutText).toBe("");
  });

  it("--json output is valid JSON with _meta.deprecated === true on failure", async () => {
    const { default: validateCommand } = await import("./validate.js");
    const { parsed } = await runAndParseJsonEnvelope(validateCommand);
    expect(parsed.ok).toBe(false);
    expect(parsed._meta.deprecated).toBe(true);
  });
});
