// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { TimelineAutomationLaneSlot } from "./TimelineAutomationLane";
import type { AutomationLaneBinding, UseAutomationLanesResult } from "./useAutomationLanes";
import type { TimelineElement } from "../store/timelineElement";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const element: TimelineElement = {
  id: "bgm",
  key: "bgm",
  tag: "audio",
  start: 0,
  duration: 6,
  track: 0,
};

function mountSlot(binding: Partial<AutomationLaneBinding>) {
  const onRangeClear = vi.fn();
  const lanes: UseAutomationLanesResult = {
    bind: () => ({
      automation: { version: 1, lanes: [] },
      lanes: [{ target: "volume", points: [{ t: 0, v: 1 }] }],
      chain: null,
      onPreview: vi.fn(),
      onCommit: vi.fn(),
      onSelect: vi.fn(),
      readOnly: false,
      selection: null,
      onRangeSelect: vi.fn(),
      onRangeClear,
      ...binding,
    }),
  };
  const host = document.createElement("div");
  document.body.append(host);
  act(() => {
    createRoot(host).render(
      <TimelineAutomationLaneSlot
        element={element}
        isSelected={false}
        lanes={lanes}
        pps={100}
        laneCount={0}
        accentColor="#0af"
        currentTime={0}
      />,
    );
  });
  return { onRangeClear };
}

describe("TimelineAutomationLaneSlot stale-selection guard", () => {
  it("clears the selection when its lane's target no longer exists", () => {
    const { onRangeClear } = mountSlot({
      selection: { elementKey: "bgm", target: "fx.gone.wet", t0: 1, t1: 2 },
    });
    expect(onRangeClear).toHaveBeenCalledTimes(1);
  });

  it("leaves an in-scope selection alone", () => {
    const { onRangeClear } = mountSlot({
      selection: { elementKey: "bgm", target: "volume", t0: 1, t1: 2 },
    });
    expect(onRangeClear).not.toHaveBeenCalled();
  });
});
