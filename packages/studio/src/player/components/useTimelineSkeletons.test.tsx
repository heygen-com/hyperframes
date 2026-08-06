// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentJob, TimelineSkeleton } from "../../components/editor/agentGlyphs";
import type { TimelineElement } from "../store/playerStore";

/**
 * The hook reads two sources it does not own: the agent's runs, which arrive
 * through the DomEdit context and are absent in a standalone player, and the
 * timeline's own elements, which decide which lanes exist.
 */
const contextJobs = vi.hoisted(() => ({ current: null as AgentJob[] | null }));
const storeElements = vi.hoisted(() => ({ current: [] as TimelineElement[] }));

vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditSelectionContextOptional: () =>
    contextJobs.current === null ? null : { agentJobs: contextJobs.current },
}));

vi.mock("../store/playerStore", () => ({
  usePlayerStore: (select: (state: { elements: TimelineElement[] }) => unknown) =>
    select({ elements: storeElements.current }),
}));

const { useTimelineSkeletons } = await import("./useTimelineSkeletons");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  contextJobs.current = null;
  storeElements.current = [];
  document.body.innerHTML = "";
});

function clip(lane: number, authoredTrack: number): TimelineElement {
  return {
    id: `clip-${lane}`,
    tag: "div",
    start: 0,
    duration: 1,
    track: lane,
    authoredTrack,
  } as TimelineElement;
}

function job(partial: Partial<AgentJob> & { skeletons?: TimelineSkeleton[] }): AgentJob {
  return {
    id: "job-1",
    kind: "codex",
    label: "Codex",
    target: "#title",
    instruction: "add a card",
    status: "running",
    activity: "",
    startedAt: Date.now(),
    ...partial,
  } as AgentJob;
}

/** Render the hook in a throwaway component and hand back what it returned. */
function layout() {
  let value: ReturnType<typeof useTimelineSkeletons> | null = null;
  function Probe() {
    value = useTimelineSkeletons();
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(React.createElement(Probe)));
  act(() => root.unmount());
  return value!;
}

describe("useTimelineSkeletons", () => {
  it("places a declared clip on the lane its authored track packs onto", () => {
    // Authored 0, 4, 9 pack onto lanes 0, 1, 2.
    storeElements.current = [clip(0, 0), clip(1, 4), clip(2, 9)];
    contextJobs.current = [job({ skeletons: [{ track: 9, start: 1, end: 2, label: "Card" }] })];

    expect(layout().placed).toEqual([{ key: "job-1:0", start: 1, end: 2, label: "Card", lane: 2 }]);
    expect(layout().incoming).toEqual([]);
  });

  it("treats a declared track with no clips as a track that does not exist yet", () => {
    storeElements.current = [clip(0, 0)];
    contextJobs.current = [job({ skeletons: [{ track: 7, start: 0, end: 1 }] })];

    const { placed, incoming, incomingTracks } = layout();
    expect(placed).toEqual([]);
    expect(incoming).toEqual([{ key: "job-1:0", start: 0, end: 1, label: undefined, lane: 7 }]);
    expect(incomingTracks).toEqual([7]);
  });

  // A settled run's promise is over; the composition reload is what replaces it.
  it.each(["done", "failed", "cancelled"] as const)("ignores a run that is %s", (status) => {
    storeElements.current = [clip(0, 0)];
    contextJobs.current = [job({ status, skeletons: [{ track: 0, start: 0, end: 1 }] })];

    expect(layout().placed).toEqual([]);
  });

  it("keeps a run that is waiting on the user, which is still going", () => {
    storeElements.current = [clip(0, 0)];
    contextJobs.current = [
      job({ status: "awaiting-permission", skeletons: [{ track: 0, start: 0, end: 1 }] }),
    ];

    expect(layout().placed).toHaveLength(1);
  });

  it("draws both runs' clips when two are going at once", () => {
    storeElements.current = [clip(0, 0), clip(1, 1)];
    contextJobs.current = [
      job({ id: "a", skeletons: [{ track: 0, start: 0, end: 1 }] }),
      job({ id: "b", skeletons: [{ track: 1, start: 2, end: 3 }] }),
    ];

    expect(layout().placed.map((entry) => entry.key)).toEqual(["a:0", "b:0"]);
  });

  // Nothing is inferred: a busy run that declared nothing shows nothing.
  it("draws nothing for a run that declared nothing", () => {
    storeElements.current = [clip(0, 0)];
    contextJobs.current = [job({ activity: "Editing files" })];

    expect(layout()).toEqual({ placed: [], incoming: [], incomingTracks: [] });
  });

  it("draws nothing in a standalone player, which has no agent", () => {
    storeElements.current = [clip(0, 0)];
    contextJobs.current = null;

    expect(layout()).toEqual({ placed: [], incoming: [], incomingTracks: [] });
  });

  it("lists each not-yet-existing track once, in order", () => {
    storeElements.current = [clip(0, 0)];
    contextJobs.current = [
      job({
        skeletons: [
          { track: 9, start: 0, end: 1 },
          { track: 7, start: 0, end: 1 },
          { track: 9, start: 2, end: 3 },
        ],
      }),
    ];

    expect(layout().incomingTracks).toEqual([7, 9]);
    expect(layout().incoming).toHaveLength(3);
  });
});
