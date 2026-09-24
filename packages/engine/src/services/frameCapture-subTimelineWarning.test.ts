import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureSession } from "./frameCapture.js";
import { recordSubTimelineWarning } from "./frameCapture.js";

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
