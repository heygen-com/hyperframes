// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchModifierKey, dispatchPlainKey } from "./useAppHotkeys";
import { usePlayerStore } from "../player/store/playerStore";
import { clearAutomationClipboard, copyRange } from "../player/components/automationClipboard";
import { VOLUME_RANGE } from "@hyperframes/core/audio-automation";
import type { TimelineElement } from "../player/store/timelineElement";

/** Minimal valid fixture — TimelineElement only requires these five fields. */
const bgmElement: TimelineElement = {
  id: "bgm",
  key: "bgm",
  tag: "audio",
  start: 0,
  duration: 6,
  track: 0,
};

/** Every callback dispatchPlainKey can reach, so a test can assert which one
 *  a key resolved to. Unannotated on purpose: the parameter type is not
 *  exported, and structural inference checks it at the call site. */
function callbacks() {
  return {
    handleTimelineElementDelete: vi.fn(async () => {}),
    handleTimelineElementsDelete: vi.fn(async () => {}),
    handleTimelineElementSplit: vi.fn(async () => {}),
    handleDomEditElementDelete: vi.fn(async () => {}),
    handleUndo: vi.fn(async () => {}),
    handleRedo: vi.fn(async () => {}),
    handleCopy: vi.fn(() => false),
    handlePaste: vi.fn(async () => {}),
    handleCut: vi.fn(async () => false),
    onResetKeyframes: vi.fn(() => true),
    onDeleteSelectedKeyframes: vi.fn(),
    showToast: vi.fn(),
    leftSidebarRef: { current: null },
    domEditSelectionRef: { current: null },
  };
}

const press = (key: string) =>
  new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

const chord = (key: string) =>
  new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true, cancelable: true });

afterEach(() => {
  clearAutomationClipboard();
  usePlayerStore.getState().clearAutomationSelection();
  usePlayerStore.setState({
    elements: [],
    selectedElementId: null,
    selectedElementIds: new Set<string>(),
    selectedKeyframes: new Set<string>(),
  });
});

describe("dispatchPlainKey — Delete arbitration", () => {
  const selectBgm = () =>
    usePlayerStore.setState({ elements: [bgmElement], selectedElementId: "bgm" });

  const selectRange = () =>
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 2, t1: 4 });

  it("deletes the selected clip when no automation range is active", () => {
    selectBgm();
    const cb = callbacks();
    const e = press("Delete");
    dispatchPlainKey(e, "delete", cb);
    // The pre-existing contract, pinned so the new guard cannot widen.
    expect(cb.handleTimelineElementsDelete).toHaveBeenCalledTimes(1);
    expect(cb.handleTimelineElementsDelete).toHaveBeenCalledWith([bgmElement]);
    expect(e.defaultPrevented).toBe(true);
  });

  it("deletes EVERY clip in a marquee selection, not just the first", () => {
    // The reported bug: select all, press Delete, and one clip disappears while
    // the rest stay — still drawn as selected. The handler used `elements.find`,
    // which stops at the first match.
    const clips = ["a", "b", "c"].map((id) => ({ ...bgmElement, id, key: id }));
    usePlayerStore.setState({
      elements: clips,
      selectedElementId: null,
      selectedElementIds: new Set(["a", "b", "c"]),
    });

    const cb = callbacks();
    const e = press("Delete");
    dispatchPlainKey(e, "delete", cb);

    expect(cb.handleTimelineElementsDelete).toHaveBeenCalledTimes(1);
    const [passed] = cb.handleTimelineElementsDelete.mock.calls[0] as [typeof clips];
    expect(passed.map((c) => c.key)).toEqual(["a", "b", "c"]);
    expect(e.defaultPrevented).toBe(true);
  });

  it("hands a canvas selection its whole group instead of the timeline's partial copy", () => {
    // The reported bug: marquee 73 elements on the canvas, press Delete, and 14
    // vanish. Only those 14 owned a timeline row, and the timeline mirror drops
    // every member that does not — so deleting through it left 59 behind, still
    // drawn as selected.
    const clips = ["a", "b"].map((id) => ({ ...bgmElement, id, key: id }));
    usePlayerStore.setState({
      elements: clips,
      selectedElementId: null,
      selectedElementIds: new Set(["a", "b"]),
    });
    const domSelection = { selector: ".title", selectorIndex: 0, sourceFile: "index.html" };

    const cb = callbacks();
    cb.domEditSelectionRef = { current: domSelection } as typeof cb.domEditSelectionRef;
    const e = press("Delete");
    dispatchPlainKey(e, "delete", cb);

    expect(cb.handleDomEditElementDelete).toHaveBeenCalledWith(domSelection, {
      expandGroup: true,
    });
    expect(cb.handleTimelineElementsDelete).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it("asks for the whole group, so Cut can still take just the one it copied", () => {
    // Expanding inside the delete handler meant every caller got the group.
    // Cut copies the primary alone, so it put one element on the clipboard and
    // removed every other member with it; paste brought back one.
    usePlayerStore.setState({
      elements: [],
      selectedElementId: null,
      selectedElementIds: new Set(),
    });
    const domSelection = { selector: ".title", selectorIndex: 0, sourceFile: "index.html" };

    const cb = callbacks();
    cb.domEditSelectionRef = { current: domSelection } as typeof cb.domEditSelectionRef;
    dispatchPlainKey(press("Delete"), "delete", cb);

    expect(cb.handleDomEditElementDelete).toHaveBeenCalledWith(domSelection, { expandGroup: true });
  });

  it("includes the primary selection alongside the marquee set", () => {
    const clips = ["a", "b"].map((id) => ({ ...bgmElement, id, key: id }));
    usePlayerStore.setState({
      elements: clips,
      selectedElementId: "b",
      selectedElementIds: new Set(["a"]),
    });

    const cb = callbacks();
    dispatchPlainKey(press("Delete"), "delete", cb);

    const [passed] = cb.handleTimelineElementsDelete.mock.calls[0] as [typeof clips];
    expect(passed.map((c) => c.key).sort()).toEqual(["a", "b"]);
  });

  it("leaves the clip alone when an automation range is active", () => {
    // The bug: this listener is on window/capture so it runs BEFORE
    // useAutomationSelectionKeyboard's document/capture handler. Without the
    // guard, clearing a 2s automation range deleted the whole audio clip.
    selectBgm();
    selectRange();
    const cb = callbacks();
    const e = press("Delete");
    dispatchPlainKey(e, "delete", cb);
    expect(cb.handleTimelineElementsDelete).not.toHaveBeenCalled();
    // Must NOT be consumed: the automation handler downstream still needs it.
    expect(e.defaultPrevented).toBe(false);
  });

  it("leaves keyframe reset alone when an automation range is active", () => {
    // Backspace's reset-keyframes branch sits below the guard, so it has to be
    // covered too — otherwise Backspace wiped every keyframe on the clip.
    selectBgm();
    usePlayerStore.setState({
      keyframeCache: new Map([["bgm", { targets: [], version: 0 }]]),
    });
    selectRange();
    const cb = callbacks();
    const e = press("Backspace");
    dispatchPlainKey(e, "backspace", cb);
    expect(cb.onResetKeyframes).not.toHaveBeenCalled();
    expect(cb.handleTimelineElementsDelete).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("still lets a keyframe selection win over an automation range", () => {
    // Ordering: the keyframe guard precedes the automation one, so a keyframe
    // selection keeps Delete even with a range showing.
    selectBgm();
    selectRange();
    usePlayerStore.setState({ selectedKeyframes: new Set(["bgm:opacity:0"]) });
    const cb = callbacks();
    const e = press("Delete");
    dispatchPlainKey(e, "delete", cb);
    expect(cb.onDeleteSelectedKeyframes).toHaveBeenCalledTimes(1);
    expect(cb.handleTimelineElementsDelete).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });
});

describe("dispatchModifierKey — Cmd+C/Cmd+V arbitration", () => {
  const clip: TimelineElement = {
    id: "bgm",
    key: "bgm",
    tag: "audio",
    start: 0,
    duration: 6,
    track: 0,
  };

  it("lets the clip clipboard have Cmd+C when no automation range is active", () => {
    usePlayerStore.setState({ elements: [clip], selectedElementId: "bgm" });
    const cb = callbacks();
    dispatchModifierKey(chord("c"), "c", cb);
    expect(cb.handleCopy).toHaveBeenCalled();
  });

  it("keeps Cmd+C from the clip clipboard when an automation range is active", () => {
    // Both clipboards arming on one press double-wrote and toasted "Copied clip".
    usePlayerStore.setState({ elements: [clip], selectedElementId: "bgm" });
    usePlayerStore.getState().setAutomationSelection({
      elementKey: "bgm",
      target: "volume",
      t0: 1,
      t1: 3,
    });
    const cb = callbacks();
    const e = chord("c");
    expect(dispatchModifierKey(e, "c", cb)).toBe(true);
    expect(cb.handleCopy).not.toHaveBeenCalled();
    // No preventDefault: the automation handler downstream still needs the key.
    expect(e.defaultPrevented).toBe(false);
  });

  it("lets the clip clipboard have Cmd+V when the automation clipboard is empty", () => {
    // Nothing to paste means nothing to claim — the clip paste should still run.
    clearAutomationClipboard();
    usePlayerStore.setState({ elements: [clip], selectedElementId: "bgm" });
    usePlayerStore.getState().setAutomationSelection({
      elementKey: "bgm",
      target: "volume",
      t0: 1,
      t1: 3,
    });
    const cb = callbacks();
    dispatchModifierKey(chord("v"), "v", cb);
    expect(cb.handlePaste).toHaveBeenCalled();
  });

  it("keeps Cmd+V from duplicating the clip while an automation paste is pending", () => {
    clearAutomationClipboard();
    copyRange(
      null,
      {
        target: "volume",
        points: [
          { t: 1, v: 1 },
          { t: 3, v: 0.25 },
        ],
      },
      VOLUME_RANGE,
      1,
      3,
    );
    usePlayerStore.setState({ elements: [clip], selectedElementId: "bgm" });
    usePlayerStore.getState().setAutomationSelection({
      elementKey: "bgm",
      target: "volume",
      t0: 1,
      t1: 3,
    });
    const cb = callbacks();
    const e = chord("v");
    dispatchModifierKey(e, "v", cb);
    expect(cb.handlePaste).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});
