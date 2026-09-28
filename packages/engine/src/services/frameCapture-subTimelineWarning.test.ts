import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import type { CaptureSession } from "./frameCapture.js";
import { pollSubCompositionTimelines, recordSubTimelineWarning } from "./frameCapture.js";

function makeSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    scriptLoadFailures: [],
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
      evaluate: vi.fn(async (expr: string) => {
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
    const outcome = await pollSubCompositionTimelines(
      probe.page,
      60,
      10,
      () => [],
      undefined,
      (ids) => seen.push([...ids]),
    );

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
    const outcome = await pollSubCompositionTimelines(
      probe.page,
      60,
      10,
      () => [],
      undefined,
      (ids) => seen.push([...ids]),
    );

    expect(outcome).toBe("timeout");
    expect(seen).toEqual([[]]);
    expect(probe.matched.count).toBeGreaterThan(0);
  });
});
