// @vitest-environment happy-dom
/**
 * The timeline menus on the shared chrome.
 *
 * Three things these files owe their callers, and each fails differently:
 *
 *  - the actions still run, with the same arguments and the same hints;
 *  - the arrow keys still work, which is what the deleted `menuKeyboardNav`
 *    used to provide by hand (AE5);
 *  - the rows still classify the way the hand-rolled `<button role="menuitem">`
 *    rows did, so no global hotkey leaks into an open menu (KTD13). The shared
 *    Menu renders a `<div>` with the role, so `button` no longer catches it and
 *    the role has to carry the classification on its own.
 *
 * happy-dom has no layout, so nothing here asserts a pixel.
 */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { ClipContextMenu } from "./ClipContextMenu";
import { TrackGapContextMenu } from "./TrackGapContextMenu";
import { AutomationSelectionMenu } from "./AutomationSelectionMenu";
import { KeyframeDiamondContextMenu } from "./KeyframeDiamondContextMenu";
import { SpeedMenu } from "./SpeedMenu";
import { isTypingTarget } from "../../utils/typingTarget";
import { shouldIgnorePlaybackShortcutTarget } from "../lib/playbackShortcuts";

const trackStudioEvent = vi.hoisted(() => vi.fn());
vi.mock("../../utils/studioTelemetry", () => ({ trackStudioEvent }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; host: HTMLElement } | null = null;

function render(element: React.ReactElement): void {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  act(() => root.render(element));
}

afterEach(() => {
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  act(() => root.unmount());
  host.remove();
});

/** Base UI moves focus into the popup one task after open, not synchronously. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * A mouse click, spelled out: `HTMLElement.click()` reaches Base UI with no
 * pointer event before it, which it reads as a KEYBOARD activation, and a
 * keyboard-opened menu pre-highlights its first item. Every menu in Studio is
 * opened with a pointer.
 */
function clickWithMouse(target: Element): void {
  const init = { bubbles: true, cancelable: true, composed: true, detail: 1 };
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mousedown", init));
    target.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mouseup", init));
    target.dispatchEvent(new MouseEvent("click", init));
  });
}

function key(k: string, target: Element | null = document.activeElement): void {
  const init = { key: k, bubbles: true, cancelable: true, composed: true };
  act(() => {
    (target ?? document.body).dispatchEvent(new KeyboardEvent("keydown", init));
    (target ?? document.body).dispatchEvent(new KeyboardEvent("keyup", init));
  });
}

const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
const radios = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
const labelOf = (el: HTMLElement) => el.querySelector(".truncate")?.textContent ?? "";
const itemNamed = (label: string) => {
  const found = items().find((item) => labelOf(item) === label);
  if (!found) throw new Error(`no menu item labelled "${label}" (have: ${items().map(labelOf)})`);
  return found;
};

const clip = {
  id: "clip-1",
  // `canSplitElement` needs a stable identity to patch against, so a bare id is
  // not enough: without `hfId` the Split row is withheld and the split tests
  // would pass over a menu that never offered the action.
  hfId: "clip-1",
  tag: "video",
  start: 1,
  duration: 4,
  track: 0,
} as unknown as TimelineElement;

describe("ClipContextMenu", () => {
  it("splits at the playhead and shows the S hint", () => {
    const onSplit = vi.fn();
    render(
      <ClipContextMenu
        x={40}
        y={60}
        element={clip}
        currentTime={2.5}
        onClose={() => {}}
        onSplit={onSplit}
        onDelete={vi.fn()}
      />,
    );

    const split = itemNamed("Split at 2.50s");
    expect(split.textContent).toContain("S");
    act(() => split.click());

    expect(onSplit).toHaveBeenCalledExactlyOnceWith(clip, 2.5);
  });

  it("deletes, and closes itself through the caller's onClose", () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    render(
      <ClipContextMenu
        x={40}
        y={60}
        element={clip}
        currentTime={2.5}
        onClose={onClose}
        onSplit={vi.fn()}
        onDelete={onDelete}
      />,
    );

    act(() => itemNamed("Delete").click());

    expect(onDelete).toHaveBeenCalledExactlyOnceWith(clip);
    expect(onClose).toHaveBeenCalled();
  });

  it("offers a disabled Split when the playhead is outside the clip", () => {
    const onSplit = vi.fn();
    render(
      <ClipContextMenu
        x={40}
        y={60}
        element={clip}
        currentTime={0.5}
        onClose={() => {}}
        onSplit={onSplit}
        onDelete={vi.fn()}
      />,
    );

    const split = itemNamed("Split (move playhead inside clip)");
    expect(split.getAttribute("aria-disabled")).toBe("true");
    act(() => split.click());

    expect(onSplit).not.toHaveBeenCalled();
  });

  // AE5, on a real menu rather than a fixture. The hand-rolled arrow keys are
  // gone with `menuKeyboardNav`; this is what replaced them.
  it("activates the second item with ArrowDown twice then Enter, and closes", async () => {
    const onDelete = vi.fn();
    const onSplit = vi.fn();
    const onClose = vi.fn();
    render(
      <ClipContextMenu
        x={40}
        y={60}
        element={clip}
        currentTime={2.5}
        onClose={onClose}
        onSplit={onSplit}
        onDelete={onDelete}
      />,
    );
    await settle();

    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    await settle();

    expect(onSplit).not.toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(clip);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("TrackGapContextMenu", () => {
  it("closes the gap under the pointer and reports the hovered row", () => {
    const onCloseGap = vi.fn();
    const onHoverAction = vi.fn();
    render(
      <TrackGapContextMenu
        x={10}
        y={10}
        gapWidth={0.42}
        canCloseGap
        canCloseAllGaps={false}
        hasAnyGaps
        onClose={() => {}}
        onCloseGap={onCloseGap}
        onCloseAllGaps={vi.fn()}
        onHoverAction={onHoverAction}
      />,
    );

    const row = itemNamed("Close gap");
    expect(row.textContent).toContain("0.42s");

    act(() => {
      row.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, cancelable: true }));
    });
    expect(onHoverAction).toHaveBeenCalledWith("close-gap");

    act(() => row.click());
    expect(onCloseGap).toHaveBeenCalledOnce();

    // The unactionable row keeps its reason and does nothing.
    const all = itemNamed("Close all gaps");
    expect(all.getAttribute("title")).toBe("A clip on this track can't be moved");
  });
});

describe("SpeedMenu", () => {
  function Harness({ onRate }: { onRate: (rate: number) => void }): React.JSX.Element {
    const [rate, setRate] = useState(1);
    return (
      <SpeedMenu
        playbackRate={rate}
        setPlaybackRate={(next) => {
          onRate(next);
          setRate(next);
        }}
        disabled={false}
      />
    );
  }

  it("sets the playback rate to 1.5x and marks that row checked", async () => {
    const onRate = vi.fn();
    render(<Harness onRate={onRate} />);

    const trigger = document.querySelector<HTMLElement>('button[aria-label="Playback speed"]');
    expect(trigger?.textContent).toBe("1x");
    clickWithMouse(trigger!);
    await settle();

    const checked = () =>
      radios()
        .filter((el) => el.getAttribute("aria-checked") === "true")
        .map(labelOf);
    expect(checked()).toEqual(["1x"]);

    const target = radios().find((el) => labelOf(el) === "1.5x");
    act(() => target!.click());
    await settle();

    expect(onRate).toHaveBeenCalledExactlyOnceWith(1.5);
    expect(trackStudioEvent).toHaveBeenCalledWith("playback", {
      action: "speed_change",
      rate: 1.5,
    });
    // The checked row and the trigger both read the new rate: a radio group
    // that reported the choice but kept the old dot would look like a no-op.
    expect(checked()).toEqual(["1.5x"]);
    expect(
      document.querySelector<HTMLElement>('button[aria-label="Playback speed"]')?.textContent,
    ).toBe("1.5x");
  });
});

// KTD13. `typingTarget` and `playbackShortcuts` gate every global hotkey on
// exact role strings, and the rows these menus used to render were
// `<button role="menuitem">` — matched by `button` whatever the role said.
// Base UI renders a `<div>`, so a role that stopped being classified would let
// Space and the arrow keys reach the player out of an open menu.
describe("hotkey classification", () => {
  const open = async (element: React.ReactElement) => {
    render(element);
    await settle();
  };

  it.each([
    [
      "clip",
      <ClipContextMenu
        key="clip"
        x={0}
        y={0}
        element={clip}
        currentTime={2.5}
        onClose={() => {}}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
      />,
    ],
    [
      "track gap",
      <TrackGapContextMenu
        key="gap"
        x={0}
        y={0}
        gapWidth={0.4}
        canCloseGap
        canCloseAllGaps
        hasAnyGaps
        onClose={() => {}}
        onCloseGap={vi.fn()}
        onCloseAllGaps={vi.fn()}
        onHoverAction={vi.fn()}
      />,
    ],
    [
      "automation selection",
      <AutomationSelectionMenu
        key="automation"
        x={0}
        y={0}
        onClose={() => {}}
        onInsertShape={vi.fn()}
        onSimplify={vi.fn()}
        canSimplify
      />,
    ],
    [
      "keyframe diamond",
      <KeyframeDiamondContextMenu
        key="keyframe"
        state={{ x: 0, y: 0, element: clip, elementId: "clip-1", percentage: 50 }}
        onClose={() => {}}
        onDeleteAll={vi.fn()}
      />,
    ],
  ])("classifies every row of the %s menu as somewhere hotkeys stop", async (_name, element) => {
    await open(element);

    const rows = items();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(isTypingTarget(row)).toBe(false);
      expect(shouldIgnorePlaybackShortcutTarget(row)).toBe(true);
    }
  });

  it("classifies every row of the speed menu as somewhere hotkeys stop", async () => {
    render(<SpeedMenu playbackRate={1} setPlaybackRate={vi.fn()} disabled={false} />);
    clickWithMouse(document.querySelector<HTMLElement>('button[aria-label="Playback speed"]')!);
    await settle();

    const rows = radios();
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(isTypingTarget(row)).toBe(false);
      expect(shouldIgnorePlaybackShortcutTarget(row)).toBe(true);
    }
  });
});
