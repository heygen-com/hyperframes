// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { usePlayerStore } from "../player/store/playerStore";
import { useAutomationSelectionKeyboard } from "./useAutomationSelectionKeyboard";
import type {
  AutomationLaneBinding,
  UseAutomationLanesResult,
} from "../player/components/useAutomationLanes";
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

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Host({ lanes }: { lanes: UseAutomationLanesResult }) {
  useAutomationSelectionKeyboard({ lanes });
  return null;
}

const key = (k: string) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  act(() => void document.dispatchEvent(e));
};

describe("useAutomationSelectionKeyboard", () => {
  const setup = (binding: Partial<AutomationLaneBinding>) => {
    const onCommit = vi.fn();
    const lanes: UseAutomationLanesResult = {
      bind: () => ({
        automation: {
          version: 1,
          lanes: [
            {
              target: "volume",
              points: [
                { t: 0, v: 1 },
                { t: 2, v: 0.5 },
                { t: 4, v: 0 },
              ],
            },
          ],
        },
        lanes: [],
        chain: null,
        onPreview: vi.fn(),
        onCommit,
        onSelect: vi.fn(),
        readOnly: false,
        selection: null,
        onRangeSelect: vi.fn(),
        onRangeClear: vi.fn(),
        ...binding,
      }),
    };
    const host = document.createElement("div");
    document.body.append(host);
    act(() => createRoot(host).render(<Host lanes={lanes} />));
    return { onCommit };
  };

  it("Delete empties the selected range and pins anchors", () => {
    usePlayerStore.setState({ elements: [bgmElement], selectedElementId: "bgm" });
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 1, t1: 3 });
    const { onCommit } = setup({});
    key("Delete");
    const written = onCommit.mock.calls.at(-1)?.[0];
    const points = written?.lanes?.[0]?.points ?? [];
    expect(points.map((p: { t: number }) => p.t)).toEqual([0, 1, 3, 4]);
  });

  it("Escape clears the selection", () => {
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 1, t1: 3 });
    setup({});
    key("Escape");
    expect(usePlayerStore.getState().automationSelection).toBeNull();
  });

  it("is inert while a text input has focus", () => {
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 1, t1: 3 });
    const { onCommit } = setup({});
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    key("Delete");
    expect(onCommit).not.toHaveBeenCalled();
    input.remove();
  });
});
