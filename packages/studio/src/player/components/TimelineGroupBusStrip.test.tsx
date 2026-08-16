// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineGroupBusStrip } from "./TimelineGroupBusStrip";
import { defaultTimelineTheme } from "./timelineTheme";
import { groupLevels } from "../store/groupLevels";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  groupLevels.notify(new Map());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function renderStrip(overrides: Partial<React.ComponentProps<typeof TimelineGroupBusStrip>> = {}) {
  const onVolumeChange = vi.fn();
  const onVolumeCommit = vi.fn();
  act(() => {
    root.render(
      <TimelineGroupBusStrip
        groupId="vo"
        volume={1}
        memberLabels={["vo-1", "vo-2"]}
        onVolumeChange={onVolumeChange}
        onVolumeCommit={onVolumeCommit}
        theme={defaultTimelineTheme}
        {...overrides}
      />,
    );
  });
  return { onVolumeChange, onVolumeCommit };
}

function slider(): HTMLInputElement {
  return container.querySelector('input[type="range"]') as HTMLInputElement;
}

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  "value",
)?.set;

/** React tracks the DOM's own value setter to detect real changes — a plain
 *  `input.value = ...` assignment is invisible to it, so onChange never
 *  fires. Go through the native setter, same as this codebase's other
 *  range/text input tests (e.g. propertyPanelFlatStyleSections.test.tsx). */
function setSliderValue(input: HTMLInputElement, value: string) {
  nativeInputValueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("TimelineGroupBusStrip", () => {
  it('renders "Holds …" from the member labels, comma-joined', () => {
    renderStrip({ memberLabels: ["vo-1", "vo-2"] });
    expect(container.textContent).toContain("Holds vo-1, vo-2");
  });

  it("falls back to a neutral line when a group has no members yet", () => {
    renderStrip({ memberLabels: [] });
    expect(container.textContent).toContain("Holds nothing yet");
  });

  it("live-writes on every drag tick, but only commits once on release", () => {
    const { onVolumeChange, onVolumeCommit } = renderStrip({ volume: 1 });
    const input = slider();

    act(() => setSliderValue(input, "1.2"));
    act(() => setSliderValue(input, "1.5"));
    expect(onVolumeChange).toHaveBeenCalledTimes(2);
    expect(onVolumeChange).toHaveBeenLastCalledWith(1.5);
    expect(onVolumeCommit).not.toHaveBeenCalled();

    act(() => {
      input.value = "1.5";
      input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    expect(onVolumeCommit).toHaveBeenCalledTimes(1);
    expect(onVolumeCommit).toHaveBeenCalledWith(1.5);
  });

  it("clamps the volume slider to the 0..2 range", () => {
    const { onVolumeChange } = renderStrip();
    const input = slider();
    expect(input.min).toBe("0");
    expect(input.max).toBe("2");

    act(() => setSliderValue(input, "2"));
    expect(onVolumeChange).toHaveBeenLastCalledWith(2);
  });

  it("the level bar tracks a live reading and shows nothing extra when it isn't clipping", () => {
    vi.useFakeTimers();
    renderStrip();
    act(() => {
      groupLevels.notify(new Map([["vo", { level: 0.4, clipped: false }]]));
      vi.advanceTimersByTime(40); // past useGroupLevel's 33ms throttle
    });
    expect(container.textContent).not.toContain("Too loud");
  });

  it('shows "Too loud" while clipped and holds it for ~2s after clipping stops', () => {
    vi.useFakeTimers();
    renderStrip();

    act(() => {
      groupLevels.notify(new Map([["vo", { level: 0.9, clipped: true }]]));
      vi.advanceTimersByTime(40);
    });
    expect(container.textContent).toContain("Too loud");

    // Clipping stops — the warning must still hold for a couple seconds.
    act(() => {
      groupLevels.notify(new Map([["vo", { level: 0.2, clipped: false }]]));
      vi.advanceTimersByTime(40);
    });
    expect(container.textContent).toContain("Too loud");

    act(() => {
      vi.advanceTimersByTime(2001);
    });
    expect(container.textContent).not.toContain("Too loud");
  });

  it("never renders a dB number anywhere in the strip (design constraint: no dB, no peak-hold readout)", () => {
    vi.useFakeTimers();
    renderStrip({ volume: 1.5 });
    act(() => {
      groupLevels.notify(new Map([["vo", { level: 0.9, clipped: true }]]));
      vi.advanceTimersByTime(40);
    });
    expect(container.textContent ?? "").not.toMatch(/dB/i);
  });
});
