// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { useAnimatedPropertyCommit } from "./useAnimatedPropertyCommit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.setState({ autoKeyframeEnabled: true, currentTime: 0 });
});

const selection = { id: "box", selector: "#box" } as DomEditSelection;

const keyframedAnim = {
  id: "#box-to-position",
  targetSelector: "#box",
  propertyGroup: "position",
  method: "to",
  properties: {},
  resolvedStart: 0,
  duration: 2,
  keyframes: {
    keyframes: [
      { percentage: 0, properties: { x: 0, y: 0 } },
      { percentage: 100, properties: { x: 100, y: 0 } },
    ],
  },
} as unknown as GsapAnimation;

type Commit = (
  selection: DomEditSelection,
  props: Record<string, number | string>,
) => Promise<void>;

/** Renders the hook and hands its commit function to the caller via a ref callback. */
function renderCommitHook(
  mutations: Array<Record<string, unknown>>,
  onReady: (commit: Commit) => void,
) {
  function Harness() {
    const { commitAnimatedProperties } = useAnimatedPropertyCommit({
      selectedGsapAnimations: [keyframedAnim],
      gsapCommitMutation: async (_sel, mutation) => {
        mutations.push(mutation);
      },
      addGsapAnimation: vi.fn(),
      convertToKeyframes: vi.fn(),
      previewIframeRef: { current: null },
      bumpGsapCache: vi.fn(),
    });
    onReady(commitAnimatedProperties);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<Harness />);
  });
  return root;
}

// Regression (#1808): a "3D transform" / design-panel property edit on an
// element that already has a keyframed tween is the ACTUAL path a manual
// canvas nudge exercises (not the raw drag intercept) — with auto-keyframe
// off, it must shift the whole tween instead of adding/updating a keyframe
// at the playhead.
describe("useAnimatedPropertyCommit — autoKeyframeEnabled toggle (#1808)", () => {
  it("shifts the whole tween instead of updating a keyframe when the toggle is off", async () => {
    usePlayerStore.setState({ autoKeyframeEnabled: false, currentTime: 0 });
    const mutations: Array<Record<string, unknown>> = [];
    let commit: Commit | undefined;
    const root = renderCommitHook(mutations, (fn) => (commit = fn));

    await act(async () => {
      await commit!(selection, { x: 50 });
    });

    expect(mutations).toHaveLength(1);
    expect(mutations[0]!.type).toBe("replace-with-keyframes");
    act(() => root.unmount());
  });

  it("still updates a keyframe at the playhead when the toggle is on (default)", async () => {
    const mutations: Array<Record<string, unknown>> = [];
    let commit: Commit | undefined;
    const root = renderCommitHook(mutations, (fn) => (commit = fn));

    await act(async () => {
      await commit!(selection, { x: 50 });
    });

    expect(mutations.some((m) => m.type === "update-keyframe" || m.type === "add-keyframe")).toBe(
      true,
    );
    expect(mutations.some((m) => m.type === "replace-with-keyframes")).toBe(false);
    act(() => root.unmount());
  });
});
