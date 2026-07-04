import { describe, expect, it, vi } from "vitest";
import {
  extractCompositionErrorsFromLint,
  raceMediaReady,
  shouldIgnoreRequestFailure,
  waitForPreferredSeekTarget,
} from "./validate.js";
import type { ProjectLintResult } from "../utils/lintProject.js";

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
