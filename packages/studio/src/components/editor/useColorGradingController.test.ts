// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHfColorGrading } from "@hyperframes/core/color-grading";
import { useColorGradingController } from "./useColorGradingController";
import type { DomEditSelection } from "./domEditing";

function freshPopGrading() {
  const next = normalizeHfColorGrading({ preset: "fresh-pop", intensity: 1 });
  if (!next) throw new Error("expected fresh-pop preset to normalize");
  return next;
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function makeElement(overrides: Partial<DomEditSelection> = {}): DomEditSelection {
  return {
    element: document.createElement("video"),
    id: "s1-bg",
    selector: "#s1-bg",
    label: "S1 Background",
    tagName: "video",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
    textContent: "",
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
    ...overrides,
  } as DomEditSelection;
}

function HookHost({
  onState,
  onSetAttributeLive,
}: {
  onState: (state: ReturnType<typeof useColorGradingController>) => void;
  onSetAttributeLive: (attr: string, value: string | null) => void;
}) {
  const state = useColorGradingController({
    projectId: "proj",
    element: makeElement(),
    onSetAttributeLive,
  });
  onState(state);
  return null;
}

function renderHook(onSetAttributeLive: (attr: string, value: string | null) => void) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let latest: ReturnType<typeof useColorGradingController> | undefined;
  act(() => {
    root.render(
      React.createElement(HookHost, {
        onState: (s: ReturnType<typeof useColorGradingController>) => (latest = s),
        onSetAttributeLive,
      }),
    );
  });
  return {
    root,
    get state() {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
  };
}

describe("useColorGradingController", () => {
  it("starts with the neutral (inactive) grading and idle compare state", () => {
    const { root, state } = renderHook(vi.fn());
    expect(state.grading.preset).toBe("neutral");
    expect(state.compareEnabled).toBe(false);
    act(() => root.unmount());
  });

  it("commitColorGrading updates grading state synchronously and schedules a debounced persist", async () => {
    vi.useFakeTimers();
    const onSetAttributeLive = vi.fn();
    const { root, state } = renderHook(onSetAttributeLive);
    act(() => {
      state.commitColorGrading(freshPopGrading());
    });
    expect(onSetAttributeLive).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onSetAttributeLive).toHaveBeenCalledTimes(1);
    const [attr, value] = onSetAttributeLive.mock.calls[0] as [string, string];
    expect(attr).toBe("color-grading");
    expect(value).toContain("fresh-pop");
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("resetGrading returns to the neutral preset", () => {
    const { root, state } = renderHook(vi.fn());
    act(() => {
      state.commitColorGrading(freshPopGrading());
    });
    act(() => {
      state.resetGrading();
    });
    expect(state.grading.preset).toBe("neutral");
    act(() => root.unmount());
  });
});
