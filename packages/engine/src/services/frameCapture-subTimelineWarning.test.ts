import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import type { CaptureSession } from "./frameCapture.js";
import { pollSubCompositionTimelines, recordSubTimelineWarning } from "./frameCapture.js";

function makeSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    scriptLoadFailures: [],
    pageErrors: [],
    warnings: [],
    ...overrides,
  } as unknown as CaptureSession;
}

describe("recordSubTimelineWarning", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records nothing when the wait succeeded or never ran", () => {
    for (const outcome of ["ready", undefined] as const) {
      const session = makeSession({ subTimelineWaitOutcome: outcome });
      recordSubTimelineWarning(session, 45_000);
      expect(session.warnings).toEqual([]);
    }
  });

  // The remedy used to live only in the stderr line inside the poll. A caller
  // reading the structured `warnings` (the render summary, the JSON result)
  // got the symptom with no way to act on it.
  it("names the data-no-timeline remedy on a timeout", () => {
    const session = makeSession({ subTimelineWaitOutcome: "timeout" });
    recordSubTimelineWarning(session, 45_000);

    expect(session.warnings).toHaveLength(1);
    const [warning] = session.warnings;
    expect(warning.code).toBe("sub_timeline_readiness_timeout");
    expect(warning.message).toContain("45000ms");
    expect(warning.message).toContain("data-no-timeline");
    expect(warning.message).toContain("window.__timelines[id]");
    // Miao's ask: the author must learn the wait can be theirs to switch off,
    // not only that something timed out.
    expect(warning.message).toContain("can be intentional");
    expect(warning.details).toMatchObject({ timeoutMs: 45_000, pendingCompositionIds: [] });
  });

  it("names the still-unregistered composition ids when the poll reported them", () => {
    const session = makeSession({
      subTimelineWaitOutcome: "timeout",
      pendingTimelineIds: ["scene-2", "scene-5"],
    });
    recordSubTimelineWarning(session, 45_000);

    const [warning] = session.warnings;
    expect(warning.message).toContain("still unregistered: scene-2, scene-5");
    expect(warning.details).toMatchObject({ pendingCompositionIds: ["scene-2", "scene-5"] });
  });

  // An empty list must not print an empty parenthetical.
  it("omits the id clause when no ids were reported", () => {
    const session = makeSession({ subTimelineWaitOutcome: "timeout", pendingTimelineIds: [] });
    recordSubTimelineWarning(session, 45_000);

    expect(session.warnings[0].message).not.toContain("still unregistered");
  });

  // The script-failure branch is a different diagnosis: the timeline can never
  // arrive, so data-no-timeline is the wrong advice there.
  it("leaves the script-failure branch alone", () => {
    const session = makeSession({
      subTimelineWaitOutcome: "script_failure",
      scriptLoadFailures: ["https://example.test/scene.js"],
      pendingTimelineIds: ["scene-2"],
    });
    recordSubTimelineWarning(session, 45_000);

    const [warning] = session.warnings;
    expect(warning.code).toBe("sub_timeline_script_failure");
    expect(warning.message).toContain("https://example.test/scene.js");
    expect(warning.message).not.toContain("data-no-timeline");
  });

  it("hands a script failure to the session's hook, so the caller can end the render there", () => {
    const hook = vi.fn();
    const failed = makeSession({
      options: { onSubTimelineScriptFailure: hook },
      subTimelineWaitOutcome: "script_failure",
      scriptLoadFailures: ["https://example.test/scene.js"],
    } as Partial<CaptureSession>);
    recordSubTimelineWarning(failed, 45_000);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0].map((w: { code: string }) => w.code)).toEqual([
      "sub_timeline_script_failure",
    ]);

    const slow = makeSession({
      options: { onSubTimelineScriptFailure: hook },
      subTimelineWaitOutcome: "timeout",
    } as Partial<CaptureSession>);
    recordSubTimelineWarning(slow, 45_000);
    const isolated = makeSession({
      options: { onSubTimelineScriptFailure: hook },
      subTimelineWaitOutcome: "script_failure",
      pageErrors: ["runtime-error:boom"],
      isolatedCompositions: [{ compositionId: "hook", elementId: "scene-hook" }],
    } as Partial<CaptureSession>);
    recordSubTimelineWarning(isolated, 45_000);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("lets the hook's error out of the recording, ending the wait", () => {
    const session = makeSession({
      options: {
        onSubTimelineScriptFailure: () => {
          throw new Error("stop here");
        },
      },
      subTimelineWaitOutcome: "script_failure",
      scriptLoadFailures: ["https://example.test/scene.js"],
    } as Partial<CaptureSession>);
    expect(() => recordSubTimelineWarning(session, 45_000)).toThrow("stop here");
    expect(session.warnings.map((w) => w.code)).toEqual(["sub_timeline_script_failure"]);
  });

  it("turns a timeout with an uncaught page error into a script failure naming data-no-timeline", () => {
    const session = makeSession({
      subTimelineWaitOutcome: "timeout",
      pageErrors: ["runtime-error:ReferenceError: gsap is not defined"],
    });
    recordSubTimelineWarning(session, 45_000);

    expect(session.subTimelineWaitOutcome).toBe("timeout");
    const [warning] = session.warnings;
    expect(warning.code).toBe("sub_timeline_script_failure");
    expect(warning.message).toContain("ReferenceError: gsap is not defined");
    expect(warning.message).toContain("data-no-timeline");
    expect(warning.details).toMatchObject({
      sources: ["runtime-error:ReferenceError: gsap is not defined"],
    });
  });

  it("names the composition whose script threw, not a load failure", () => {
    const session = makeSession({
      subTimelineWaitOutcome: "script_failure",
      pageErrors: [
        "runtime-error:TypeError: Cannot read properties of null (reading 'appendChild')",
      ],
      pendingTimelineIds: ["root"],
    });
    recordSubTimelineWarning(session, 45_000);

    const message = session.warnings[0].message;
    expect(message).toContain("threw before its timeline registered");
    expect(message).toContain("still unregistered: root");
    expect(message).not.toContain("failed to load");
  });

  it("says GSAP was not loaded yet when a script reads timeline before GSAP runs", () => {
    const session = makeSession({
      subTimelineWaitOutcome: "script_failure",
      pageErrors: ["runtime-error:TypeError: Cannot read properties of null (reading 'timeline')"],
      pendingTimelineIds: ["main"],
    });
    recordSubTimelineWarning(session, 45_000);

    expect(session.warnings[0].message).toContain(
      "GSAP was not loaded yet when that script ran: load the GSAP script before the first script that uses gsap.",
    );
  });

  it("adds no GSAP hint for a null read that is not GSAP's", () => {
    const session = makeSession({
      subTimelineWaitOutcome: "script_failure",
      pageErrors: [
        "runtime-error:TypeError: Cannot read properties of null (reading 'appendChild')",
      ],
    });
    recordSubTimelineWarning(session, 45_000);

    expect(session.warnings[0].message).not.toContain("GSAP was not loaded");
  });

  it("names the missing script, not the error it caused, when both are present", () => {
    const session = makeSession({
      subTimelineWaitOutcome: "script_failure",
      scriptLoadFailures: ["https://example.test/gsap.js"],
      pageErrors: ["runtime-error:ReferenceError: gsap is not defined"],
    });
    recordSubTimelineWarning(session, 45_000);

    expect(session.warnings[0].message).toContain("failed to load");
  });

  it("names an integrity-blocked script as one that failed to load", () => {
    const session = makeSession({
      subTimelineWaitOutcome: "script_failure",
      scriptLoadFailures: ["runtime-error:subresource-integrity"],
    });
    recordSubTimelineWarning(session, 45_000);

    expect(session.warnings[0].message).toContain("failed to load");
  });

  // An unrelated error on a page whose timelines did register must not fail the render.
  it("ignores an uncaught page error when the timelines registered", () => {
    const session = makeSession({
      subTimelineWaitOutcome: "ready",
      pageErrors: ["runtime-error:Error: third-party widget failed"],
    });
    recordSubTimelineWarning(session, 45_000);

    expect(session.subTimelineWaitOutcome).toBe("ready");
    expect(session.warnings).toEqual([]);
  });
});

// The warning text is only as good as the ids handed to it, and that handoff
// lives in the poll, not in recordSubTimelineWarning. CI caught a TypeError
// here that this file could not see: the enumerate step used to cast
// page.evaluate's result with `as string[]`, so any caller whose evaluate did
// not return an array crashed the DIAGNOSTIC path.
describe("pollSubCompositionTimelines pending-id reporting", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // `data-composition-id` appears in the READINESS expression too, so a stub
  // keyed on it answers the readiness poll with the enumerate payload and the
  // poll returns "ready" before it ever enumerates. `m.push(` is unique to the
  // enumerate step. `matched` then asserts the stub was really reached, so a
  // later edit to that expression fails loudly instead of testing nothing.
  function pageReturning(enumerateResult: unknown) {
    const matched = { count: 0 };
    const page = {
      evaluate: vi.fn(async (expr: string | (() => unknown)) => {
        if (typeof expr === "function") return true;
        if (!expr.includes("m.push(")) return false;
        matched.count++;
        return enumerateResult;
      }),
    } as unknown as Page;
    return { page, matched };
  }

  it("reports the still-unregistered ids to onPending", async () => {
    const seen: string[][] = [];
    const probe = pageReturning(["scene-2", "scene-5"]);
    const outcome = await pollSubCompositionTimelines(probe.page, 60, {
      intervalMs: 10,
      getScriptLoadFailures: () => [],
      onPending: (ids) => seen.push([...ids]),
    });

    expect(outcome).toBe("timeout");
    expect(seen).toEqual([["scene-2", "scene-5"]]);
    expect(probe.matched.count).toBeGreaterThan(0);
  });

  // `false` is what a blanket evaluate stub returns, and it is what CI hit: the
  // enumerate result used to be cast with `as string[]`, so a non-array threw a
  // TypeError on the very path that exists to report a problem.
  it("degrades to no ids instead of throwing when the page returns a non-array", async () => {
    const seen: string[][] = [];
    const probe = pageReturning(false);
    const outcome = await pollSubCompositionTimelines(probe.page, 60, {
      intervalMs: 10,
      getScriptLoadFailures: () => [],
      onPending: (ids) => seen.push([...ids]),
    });

    expect(outcome).toBe("timeout");
    expect(seen).toEqual([[]]);
    expect(probe.matched.count).toBeGreaterThan(0);
  });
});
