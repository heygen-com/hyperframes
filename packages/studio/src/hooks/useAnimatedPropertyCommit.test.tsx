// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { useAnimatedPropertyCommit } from "./useAnimatedPropertyCommit";
import { mountReactHarness } from "./domSelectionTestHarness";

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
function renderHookWith(
  animations: GsapAnimation[],
  onMutation: (mutation: Record<string, unknown>, label: string) => void,
  onReady: (commit: Commit) => void,
) {
  function Harness() {
    const { commitAnimatedProperties } = useAnimatedPropertyCommit({
      selectedGsapAnimations: animations,
      gsapCommitMutation: async (_sel, mutation, options) => {
        onMutation(mutation, options.label);
      },
      addGsapAnimation: vi.fn(),
      convertToKeyframes: vi.fn(),
      previewIframeRef: { current: null },
      bumpGsapCache: vi.fn(),
    });
    onReady(commitAnimatedProperties);
    return null;
  }
  return mountReactHarness(<Harness />);
}

function renderCommitHook(
  mutations: Array<Record<string, unknown>>,
  onReady: (commit: Commit) => void,
) {
  return renderHookWith([keyframedAnim], (mutation) => mutations.push(mutation), onReady);
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

// Regression: commitStaticSet picked the FIRST `set` for the selector with no
// group check — a panel W edit on a static element merged `width` into the
// POSITION set (`tl.set("#el",{x,y,width})`), a mixed-group set the split
// machinery exists to prevent, labeled "Set 3D transform" in undo history.
describe("commitStaticSet group routing", () => {
  const positionSet = {
    id: "#box-set-0-position",
    targetSelector: "#box",
    propertyGroup: "position",
    method: "set",
    properties: { x: 10, y: 20 },
  } as unknown as GsapAnimation;

  function renderStaticHook(
    committed: Array<{ mutation: Record<string, unknown>; label: string }>,
    onReady: (commit: Commit) => void,
  ) {
    return renderHookWith(
      [positionSet],
      (mutation, label) => committed.push({ mutation, label }),
      onReady,
    );
  }

  it("width edit creates a size set instead of contaminating the position set", async () => {
    const committed: Array<{ mutation: Record<string, unknown>; label: string }> = [];
    let commit!: Commit;
    renderStaticHook(committed, (c) => (commit = c));
    await act(async () => {
      await commit(selection, { width: 500 });
    });
    const updates = committed.filter((c) => c.mutation.type === "update-properties");
    expect(updates).toHaveLength(0);
    const adds = committed.filter((c) => c.mutation.type === "add");
    expect(adds).toHaveLength(1);
    expect(adds[0]!.mutation.properties).toEqual({ width: 500 });
    expect(adds[0]!.label).toBe("Resize layer");
  });

  it("x edit updates the position set with a Move label", async () => {
    const committed: Array<{ mutation: Record<string, unknown>; label: string }> = [];
    let commit!: Commit;
    renderStaticHook(committed, (c) => (commit = c));
    await act(async () => {
      await commit(selection, { x: 400 });
    });
    const update = committed.find((c) => c.mutation.type === "update-properties");
    expect(update).toBeDefined();
    expect(update!.mutation.animationId).toBe("#box-set-0-position");
    expect(update!.label).toBe("Move layer");
  });

  it("width edit updates its duration-zero size hold instead of appending a set", async () => {
    const instantSizeHold = {
      id: "#box-to-0-size",
      targetSelector: "#box",
      propertyGroup: "size",
      method: "to",
      properties: { width: 150, height: 150 },
      resolvedStart: 0,
      duration: 0,
      extras: { immediateRender: "__raw:true" },
    } as unknown as GsapAnimation;
    const committed: Array<{ mutation: Record<string, unknown>; label: string }> = [];
    let commit!: Commit;
    renderHookWith(
      [positionSet, instantSizeHold],
      (mutation, label) => committed.push({ mutation, label }),
      (c) => (commit = c),
    );

    await act(async () => {
      await commit(selection, { width: 344 });
    });

    expect(committed).toHaveLength(1);
    expect(committed[0]!.mutation).toEqual({
      type: "update-properties",
      animationId: instantSizeHold.id,
      properties: { width: 344 },
    });
    expect(committed[0]!.label).toBe("Resize layer");
    expect(committed.some(({ mutation }) => mutation.type === "add")).toBe(false);
    expect(committed[0]!.mutation.animationId).not.toBe(positionSet.id);
  });
});
