import { describe, expect, it, beforeEach } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  commitGsapPositionFromDrag,
  parkPlayheadOnKeyframe,
  type GsapDragCommitCallbacks,
} from "./gsapDragCommit";
import { usePlayerStore } from "../player/store/playerStore";

// Minimal selection whose element has no drag-baseline attributes (origX/Y = 0).
const selection = (): DomEditSelection =>
  ({
    id: "puck-a",
    selector: "#puck-a",
    element: {
      style: { getPropertyValue: () => "", setProperty: () => {} },
      getAttribute: () => null,
      removeAttribute: () => {},
      getBoundingClientRect: () => ({ top: 0, left: 0 }),
    },
  }) as unknown as DomEditSelection;

const flatTween = (): GsapAnimation =>
  ({
    id: "#puck-a-to",
    targetSelector: "#puck-a",
    method: "to",
    resolvedStart: 1.2,
    duration: 2.2,
    properties: { x: -260 },
  }) as unknown as GsapAnimation;

// What the flat tween becomes after convert-to-keyframes (returned by fetchAnimations).
const convertedTween = (): GsapAnimation =>
  ({
    id: "#puck-a-converted",
    targetSelector: "#puck-a",
    method: "to",
    resolvedStart: 1.2,
    duration: 2.2,
    keyframes: {
      keyframes: [
        { percentage: 0, properties: { x: 0, y: 0 } },
        { percentage: 100, properties: { x: -260, y: 0 } },
      ],
    },
  }) as unknown as GsapAnimation;

function recordingCallbacks(): {
  types: string[];
  mutations: Array<Record<string, unknown>>;
  callbacks: GsapDragCommitCallbacks;
} {
  const types: string[] = [];
  const mutations: Array<Record<string, unknown>> = [];
  return {
    types,
    mutations,
    callbacks: {
      commitMutation: async (_sel, mutation) => {
        types.push(mutation.type as string);
        mutations.push(mutation);
      },
      fetchAnimations: async () => [convertedTween()],
    },
  };
}

describe("commitGsapPositionFromDrag — flat tween", () => {
  beforeEach(() => {
    usePlayerStore.setState({ currentTime: 0, activeKeyframePct: null });
  });

  it("extends the existing tween (never spawns a parallel one) when dragged OUTSIDE its range", async () => {
    usePlayerStore.setState({ currentTime: 6 }); // outside [1.2, 3.4]
    const { types, callbacks } = recordingCallbacks();

    await commitGsapPositionFromDrag(
      selection(),
      flatTween(),
      { x: -100, y: 0 },
      { x: 0, y: 0 },
      null,
      "#puck-a",
      callbacks,
    );

    expect(types).toContain("convert-to-keyframes");
    expect(types).toContain("replace-with-keyframes"); // the extend
    expect(types).not.toContain("add-with-keyframes"); // regression: no parallel tween
  });

  it("adds a keyframe at the playhead when dragged INSIDE its range", async () => {
    usePlayerStore.setState({ currentTime: 2 }); // inside [1.2, 3.4]
    const { types, callbacks } = recordingCallbacks();

    await commitGsapPositionFromDrag(
      selection(),
      flatTween(),
      { x: -100, y: 0 },
      { x: 0, y: 0 },
      null,
      "#puck-a",
      callbacks,
    );

    expect(types).toContain("add-keyframe");
    expect(types).not.toContain("add-with-keyframes");
  });

  it("MODIFIES the selected keyframe (no extend) when one is selected, even past the tween end", async () => {
    // User clicked the 100% diamond (activeKeyframePct=100), playhead drifted past
    // the end. Expect: convert + add-keyframe AT 100% — not replace-with-keyframes.
    usePlayerStore.setState({ currentTime: 6, activeKeyframePct: 100 }); // outside [1.2, 3.4]
    const { types, mutations, callbacks } = recordingCallbacks();

    await commitGsapPositionFromDrag(
      selection(),
      flatTween(),
      { x: -100, y: 0 },
      { x: 0, y: 0 },
      null,
      "#puck-a",
      callbacks,
    );

    expect(types).toContain("add-keyframe");
    expect(types).not.toContain("replace-with-keyframes"); // not extended
    const addKf = mutations.find((m) => m.type === "add-keyframe");
    expect(addKf?.percentage).toBe(100); // modified the selected endpoint
    // consumed: cleared so the next free drag doesn't keep modifying
    expect(usePlayerStore.getState().activeKeyframePct).toBeNull();
    // parked the playhead on the edited keyframe (1.2 start + 100% * 2.2 dur),
    // so the edit is visible instead of rendering the base pose
    expect(usePlayerStore.getState().requestedSeekTime).toBe(3.4);
  });
});

describe("commitGsapPositionFromDrag — keyframed tween backfill", () => {
  beforeEach(() => {
    usePlayerStore.setState({ currentTime: 0, activeKeyframePct: null });
  });

  const keyframedTween = (): GsapAnimation =>
    ({
      id: "#puck-a-kf",
      targetSelector: "#puck-a",
      method: "to",
      resolvedStart: 1.2,
      duration: 2.2,
      keyframes: {
        keyframes: [
          { percentage: 0, properties: { x: 0 } },
          { percentage: 100, properties: { x: -260 } },
        ],
      },
    }) as unknown as GsapAnimation;

  it("passes backfillDefaults so a newly-introduced prop doesn't move the other keyframes", async () => {
    // Drag the 0% keyframe DOWN (introduces y on an x-only tween). The add-keyframe
    // must carry backfillDefaults at the element's base so 100% gets y:0, not y:780.
    usePlayerStore.setState({ currentTime: 1.2, activeKeyframePct: 0 });
    const { mutations, callbacks } = recordingCallbacks();

    await commitGsapPositionFromDrag(
      selection(),
      keyframedTween(),
      { x: 0, y: 780 }, // studioOffset: dragged straight down
      { x: 0, y: 0 }, // gsapPos → base falls back to {0,0} (selection has no base attrs)
      null,
      "#puck-a",
      callbacks,
    );

    const addKf = mutations.find((m) => m.type === "add-keyframe");
    expect(addKf).toBeDefined();
    expect(addKf?.percentage).toBe(0); // edited the selected 0% keyframe
    expect(addKf?.properties).toMatchObject({ y: 780 });
    expect(addKf?.backfillDefaults).toEqual({ x: 0, y: 0 }); // base → 100% gets y:0
  });
});

describe("commitGsapPositionFromDrag — from() tween dragged outside its range", () => {
  beforeEach(() => usePlayerStore.setState({ currentTime: 0, activeKeyframePct: null }));

  const fromTween = (): GsapAnimation =>
    ({
      id: "#title-from-400",
      targetSelector: "#title",
      method: "from",
      resolvedStart: 0.4,
      duration: 0.9,
      properties: { y: 70 },
    }) as unknown as GsapAnimation;

  it("REPLACES the split position from() tween (no parallel tween → no drop jump)", async () => {
    usePlayerStore.setState({ currentTime: 2.13 }); // outside [0.4, 1.3]
    const types: string[] = [];
    const mutations: Array<Record<string, unknown>> = [];
    const callbacks: GsapDragCommitCallbacks = {
      commitMutation: async (_s, m) => {
        types.push(m.type as string);
        mutations.push(m);
      },
      // After split-into-property-groups, the position group is a from() tween (no keyframes).
      fetchAnimations: async () => [
        {
          id: "#title-from-400-position",
          targetSelector: "#title",
          method: "from",
          propertyGroup: "position",
          resolvedStart: 0.4,
          duration: 0.9,
          properties: { y: 70 },
        } as unknown as GsapAnimation,
      ],
    };

    await commitGsapPositionFromDrag(
      selection(),
      fromTween(),
      { x: 0, y: -333 },
      { x: 0, y: 0 },
      null,
      "#title",
      callbacks,
    );

    expect(types).toContain("split-into-property-groups");
    expect(types).toContain("replace-with-keyframes");
    expect(types).not.toContain("add-with-keyframes"); // regression: no parallel tween
    const replace = mutations.find((m) => m.type === "replace-with-keyframes");
    expect(replace?.animationId).toBe("#title-from-400-position"); // replaces the split from()
  });
});

describe("parkPlayheadOnKeyframe", () => {
  beforeEach(() => usePlayerStore.setState({ requestedSeekTime: null }));

  const tween = (): GsapAnimation =>
    ({
      id: "#x",
      targetSelector: "#x",
      method: "to",
      resolvedStart: 1.2,
      duration: 2.2,
    }) as unknown as GsapAnimation;

  it("seeks to the keyframe's absolute time so the element previews AT it, not at base", () => {
    parkPlayheadOnKeyframe(tween(), 0); // tween start
    expect(usePlayerStore.getState().requestedSeekTime).toBe(1.2);
    parkPlayheadOnKeyframe(tween(), 100); // tween end
    expect(usePlayerStore.getState().requestedSeekTime).toBe(3.4);
    parkPlayheadOnKeyframe(tween(), 50); // midpoint
    expect(usePlayerStore.getState().requestedSeekTime).toBe(2.3);
  });
});
