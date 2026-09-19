// @vitest-environment happy-dom

import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { runtimeProtocolMetadata } from "@hyperframes/core/runtime/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { useTimelinePlayer } from "../hooks/useTimelinePlayer";
import { usePlayerStore } from "../store/playerStore";
import { commitPlacementDrop } from "./timelinePlacementCommit";
import { clip, createFakeProject, depsOf, dragOf } from "./timelinePlacementTestHarness";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  useTimelinePlayer();
  useEffect(() => undefined);
  return null;
}

function mountPlayer() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(React.createElement(Harness)));
  return () => act(() => root.unmount());
}

const manifestClip = (id: string, start: number, duration: number) => ({
  id,
  label: id,
  start,
  duration,
  track: 1,
  kind: "element",
  tagName: "div",
  compositionId: null,
  parentCompositionId: null,
  compositionSrc: null,
  assetUrl: null,
});

// The preview iframe keeps the pre-drop DOM until the drop's one reload, so its manifest lists the
// clip the drop already removed. It used to land mid-drop and put that clip back on the timeline.
function postStalePreviewManifest() {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        source: "hf-preview",
        type: "timeline",
        clips: [manifestClip("a", 0, 4), manifestClip("b", 4, 4), manifestClip("d", 20, 6)],
        durationInFrames: 900,
        fps: 30,
        ...runtimeProtocolMetadata(30),
      },
    }),
  );
}

function recordStoreStates(
  format: (el: { id: string; start: number; duration: number }) => string,
) {
  const states: string[] = [];
  const stop = usePlayerStore.subscribe((state) =>
    states.push(state.elements.map(format).join(" ")),
  );
  return { states, stop };
}

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

describe("a drop's timeline states never go back to an older one", () => {
  it("keeps the removed clip gone when the old preview posts its manifest mid-drop", async () => {
    const unmount = mountPlayer();
    const a = clip("a", 0, 4);
    const b = clip("b", 4, 4);
    const covering = clip("d", 20, 6);
    const preDrop = [a, b, covering];
    usePlayerStore.getState().setElements(preDrop);
    const project = createFakeProject({
      a: { start: 0, duration: 4 },
      b: { start: 4, duration: 4 },
      d: { start: 20, duration: 6 },
    });
    const remove = project.ops.remove;
    project.ops.remove = async (elements, fold) => {
      const done = await remove(elements, fold);
      act(() => postStalePreviewManifest());
      return done;
    };
    const { states, stop } = recordStoreStates((el) => `${el.id}@${el.start}`);

    await commitPlacementDrop(
      dragOf(covering, 4),
      depsOf(preDrop, project),
      "overwrite",
      project.move,
    );
    stop();

    expect(states.length).toBeGreaterThan(0);
    expect(states.every((state) => !state.includes("b@"))).toBe(true);
    expect(states.at(-1)).toContain("d@4");
    unmount();
  });

  async function firstStateAfterDrop(mode: "overwrite" | "insert", at: number) {
    const a = clip("a", 0, 4);
    const b = clip("b", 4, 4, { playbackStart: 1 });
    const dropped = clip("d", 20, 2);
    const lane = [a, b, dropped];
    usePlayerStore.getState().setElements(lane);
    const project = createFakeProject({
      a: { start: 0, duration: 4 },
      b: { start: 4, duration: 4, playbackStart: 1 },
      d: { start: 20, duration: 2 },
    });
    const { states, stop } = recordStoreStates((el) => `${el.id}@${el.start}+${el.duration}`);
    await commitPlacementDrop(dragOf(dropped, at), depsOf(lane, project), mode, project.move);
    stop();
    return states[0];
  }

  it("shows a split's head, the dropped clip and the new tail in the first state after the drop", async () => {
    // d [1,3) inside a [0,4): head [0,1), tail [3,4), all in the very first store write.
    expect(await firstStateAfterDrop("overwrite", 1)).toBe("a@0+1 b@4+4 d@1+2 a~tail@3+1");
  });

  it("marks the new tail as awaiting the reload so a second drop on it is refused", async () => {
    await firstStateAfterDrop("overwrite", 1);
    const tail = usePlayerStore.getState().elements.find((el) => el.id === "a~tail");
    expect(tail?.awaitingReload).toBe(true);
  });

  it("shows an insert's pushed clips, split head and tail in the first state after the drop", async () => {
    // d [2,4) inserted into a [0,4): head [0,2), tail [4,6), b pushed to [6,10).
    expect(await firstStateAfterDrop("insert", 2)).toBe("a@0+2 b@6+4 d@2+2 a~tail@4+2");
  });

  it("takes the preview's manifest again once the drop is over", () => {
    const unmount = mountPlayer();
    act(() => postStalePreviewManifest());
    expect(usePlayerStore.getState().elements.map((el) => el.id)).toEqual(["a", "b", "d"]);
    unmount();
  });
});
