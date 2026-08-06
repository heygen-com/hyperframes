import { describe, expect, it } from "vitest";
import type { AgentJob } from "./agentGlyphs";
import {
  OVERLAY_TERMINAL_MS,
  answerForSelection,
  deriveOverlayState,
  jobTargetsSelection,
  overlayPaintForSelection,
  refMatchesSelection,
} from "./overlayState";

const NOW = 1_700_000_000_000;

function job(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "job-1",
    kind: "claude",
    label: "Claude Code",
    target: "h1",
    targetRef: { selector: "h1", sourceFile: "index.html" },
    instruction: "make it bigger",
    status: "running",
    activity: "",
    startedAt: NOW - 1000,
    ...overrides,
  };
}

describe("deriveOverlayState", () => {
  it("lets the agent's own declaration win while the run is live", () => {
    const declared = { kind: "editing", scope: "motion", label: "Retiming" } as const;
    expect(deriveOverlayState(job({ activity: "Read · index.html", overlay: declared }))).toEqual({
      state: declared,
    });
  });

  it("never guesses a finer state than it knows: a live run is working", () => {
    // Tool names are a harness' vocabulary and change; Studio reports the
    // activity line verbatim instead of classifying it.
    expect(deriveOverlayState(job({ activity: "Read · index.html" }))?.state).toEqual({
      kind: "working",
      label: "Read · index.html",
    });
    expect(deriveOverlayState(job({ activity: "" }))?.state).toEqual({
      kind: "working",
      label: "Working",
    });
  });

  it("drops a declared working state once the process is over", () => {
    const stale = job({
      status: "done",
      endedAt: NOW,
      overlay: { kind: "editing", scope: "text" },
    });
    expect(deriveOverlayState(stale, { now: NOW })?.state.kind).toBe("done");
  });

  it("gives a waiting run its place in line", () => {
    expect(deriveOverlayState(job({ status: "queued" }), { queuePosition: 2 })?.state.label).toBe(
      "2nd in line",
    );
    expect(deriveOverlayState(job({ status: "queued" }), { queuePosition: 11 })?.state.label).toBe(
      "11th in line",
    );
    expect(deriveOverlayState(job({ status: "queued" }))?.state.label).toBe("Queued");
  });

  it("says a run finished for a beat, then hands the canvas back", () => {
    const done = job({ status: "done", endedAt: NOW - 1000 });
    expect(deriveOverlayState(done, { now: NOW })).toEqual({
      state: { kind: "done", label: "Done" },
      expiresAt: NOW - 1000 + OVERLAY_TERMINAL_MS,
    });
    expect(deriveOverlayState(done, { now: NOW + OVERLAY_TERMINAL_MS })).toBeNull();
  });

  it("never takes the canvas for a finished run with no end time", () => {
    expect(deriveOverlayState(job({ status: "done" }), { now: NOW })).toBeNull();
  });

  it("keeps a stopped run red while it shows", () => {
    const stopped = job({ status: "cancelled", endedAt: NOW });
    expect(deriveOverlayState(stopped, { now: NOW })?.state).toEqual({
      kind: "failed",
      label: "Stopped",
    });
  });
});

describe("refMatchesSelection", () => {
  const ref = { selector: ".card", selectorIndex: 2, sourceFile: "index.html" };

  it("tells repeated elements apart by index", () => {
    expect(
      refMatchesSelection(ref, { selector: ".card", selectorIndex: 2, sourceFile: "index.html" }),
    ).toBe(true);
    expect(
      refMatchesSelection(ref, { selector: ".card", selectorIndex: 3, sourceFile: "index.html" }),
    ).toBe(false);
  });

  it("settles on a DOM id when both sides have one", () => {
    expect(
      refMatchesSelection(
        { id: "title", selector: "h1", selectorIndex: 0, sourceFile: "index.html" },
        { id: "title", selector: "h1.big", selectorIndex: 4, sourceFile: "index.html" },
      ),
    ).toBe(true);
  });

  it("never matches across source files, or without either handle", () => {
    expect(
      refMatchesSelection(ref, { selector: ".card", selectorIndex: 2, sourceFile: "other.html" }),
    ).toBe(false);
    expect(refMatchesSelection(ref, { selector: null, sourceFile: "index.html" })).toBe(false);
    expect(refMatchesSelection(undefined, { selector: ".card" })).toBe(false);
    expect(refMatchesSelection(ref, null)).toBe(false);
  });
});

describe("jobTargetsSelection", () => {
  it("covers every element of a multi-selection, not just the anchor", () => {
    const multi = job({
      targetRefs: [{ selector: "p", selectorIndex: 1, sourceFile: "index.html" }],
    });
    expect(jobTargetsSelection(multi, { selector: "h1", sourceFile: "index.html" })).toBe(true);
    expect(
      jobTargetsSelection(multi, { selector: "p", selectorIndex: 1, sourceFile: "index.html" }),
    ).toBe(true);
    expect(
      jobTargetsSelection(multi, { selector: "p", selectorIndex: 2, sourceFile: "index.html" }),
    ).toBe(false);
  });
});

describe("overlayPaintForSelection", () => {
  const selection = { selector: "h1", sourceFile: "index.html" };

  it("shows what is running, not what was queued behind it", () => {
    // Newest-first ordering used to hand the badge to the last thing queued,
    // so asking for one more edit replaced "Edit · index.html" with "2nd in line".
    const jobs = [
      job({ id: "queued-later", status: "queued" }),
      job({ id: "running-now", status: "running", activity: "Edit · index.html" }),
    ];
    expect(overlayPaintForSelection(jobs, selection, NOW)?.state).toEqual({
      kind: "working",
      label: "Edit · index.html",
    });
  });

  it("shows the live run when an element has both a live and a finished one", () => {
    const jobs = [
      job({ id: "running", status: "running", activity: "Edit · index.html" }),
      job({ id: "old", status: "done", endedAt: NOW - 500 }),
    ];
    expect(overlayPaintForSelection(jobs, selection, NOW)?.state.kind).toBe("working");
  });

  it("counts a place in line from the run order, not the display order", () => {
    // The tray lists newest first; the queue runs oldest first.
    const jobs = [
      job({ id: "second", status: "queued" }),
      job({
        id: "first",
        status: "queued",
        targetRef: { selector: "p", sourceFile: "index.html" },
      }),
    ];
    expect(overlayPaintForSelection(jobs, selection, NOW)?.state.label).toBe("2nd in line");
  });

  it("moves the state to the element a declaration names instead", () => {
    const jobs = [
      job({
        status: "running",
        overlay: { kind: "reading", label: "Checking the caption", target: { selector: "p" } },
      }),
    ];
    // The run targets h1, but says it is looking at the caption.
    expect(overlayPaintForSelection(jobs, selection, NOW)).toBeNull();
    expect(
      overlayPaintForSelection(jobs, { selector: "p", sourceFile: "index.html" }, NOW)?.state.kind,
    ).toBe("reading");
  });

  it("paints nothing for an element no run is about", () => {
    expect(
      overlayPaintForSelection([job()], { selector: "p", sourceFile: "index.html" }),
    ).toBeNull();
    expect(overlayPaintForSelection([], selection)).toBeNull();
  });
});

describe("answerForSelection", () => {
  const selection = { selector: "h1", sourceFile: "index.html" };
  const never = () => false;

  function settled(overrides: Partial<AgentJob>): AgentJob {
    return job({ status: "done", endedAt: NOW, message: "did it", ...overrides });
  }

  it("shows the answer to the run that just finished", () => {
    const jobs = [settled({ id: "b", message: "second" }), settled({ id: "a", message: "first" })];
    expect(answerForSelection(jobs, selection, { since: 0, isDismissed: never })?.message).toBe(
      "second",
    );
  });

  it("never falls back to an older answer when the latest is dismissed", () => {
    // The bug this rule exists for: dismissing the newest bubble used to
    // resurface the previous one, so the canvas talked about an edit ago.
    const jobs = [settled({ id: "b", message: "second" }), settled({ id: "a", message: "first" })];
    const isDismissed = (id: string) => id === "b";
    expect(answerForSelection(jobs, selection, { since: 0, isDismissed })).toBeNull();
  });

  it("stays quiet while a newer run on that element is still going", () => {
    const jobs = [
      job({ id: "live", status: "running" }),
      settled({ id: "old", message: "about to be superseded" }),
    ];
    expect(answerForSelection(jobs, selection, { since: 0, isDismissed: never })).toBeNull();
  });

  it("ignores runs that finished before this tab was listening", () => {
    // Run history is restored from disk, and yesterday's answer is not news.
    const jobs = [settled({ id: "old", endedAt: NOW - 60_000 })];
    expect(answerForSelection(jobs, selection, { since: NOW, isDismissed: never })).toBeNull();
  });

  it("says nothing for a run with no message, or for another element", () => {
    expect(
      answerForSelection([settled({ message: undefined })], selection, {
        since: 0,
        isDismissed: never,
      }),
    ).toBeNull();
    expect(
      answerForSelection(
        [settled({})],
        { selector: "p", sourceFile: "index.html" },
        {
          since: 0,
          isDismissed: never,
        },
      ),
    ).toBeNull();
  });
});

describe("a run waiting on the user", () => {
  const selection = { selector: "h1", sourceFile: "index.html" };
  const waiting = job({
    status: "awaiting-permission",
    permission: { tool: "Write composition.html", options: [{ optionId: "yes", name: "Allow" }] },
  });

  // The person who has to answer is the one looking at the canvas.
  it("says so on the element, in the agent's words", () => {
    expect(deriveOverlayState(waiting)?.state).toEqual({
      kind: "asking",
      label: "Write composition.html",
    });
  });

  // Being waited on is the one state the user can act on, so it wins.
  it("outranks a run that is merely working on the same element", () => {
    const working = job({ id: "job-2", status: "running", activity: "Edit · index.html" });
    expect(overlayPaintForSelection([working, waiting], selection)?.state.kind).toBe("asking");
  });

  it("stops the moment the run gets going again", () => {
    const resumed = { ...waiting, status: "running" as const, activity: "Edit · index.html" };
    expect(deriveOverlayState(resumed)?.state.kind).toBe("working");
  });

  // An answer bubble about the last run must not appear over a run that has
  // stopped to ask: the element is busy, not finished.
  it("keeps the previous answer off the element while it waits", () => {
    const done = job({ id: "job-0", status: "done", message: "Widened it", endedAt: 10 });
    expect(
      answerForSelection([waiting, done], selection, { since: 0, isDismissed: () => false }),
    ).toBeNull();
  });
});
