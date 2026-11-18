// @vitest-environment happy-dom

import React, { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditing";
import { findSelectionElement } from "../components/editor/previewSelection";
import { mountReactHarness } from "./domSelectionTestHarness";
import { useStudioUrlState } from "./useStudioUrlState";
import type { StudioUrlSelectionState } from "../utils/studioUrlState";

vi.mock("../components/editor/previewSelection", () => ({ findSelectionElement: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const find = vi.mocked(findSelectionElement);
const applyDomSelection = vi.fn();
const applyMarqueeSelection = vi.fn();
const element = document.createElement("div");
const built = { element, id: "s0", sourceFile: "index.html" } as unknown as DomEditSelection;
let root: Root | null = null;

function Harness({
  selection = { sourceFile: "index.html", id: "s0" },
}: {
  selection?: StudioUrlSelectionState;
}) {
  useStudioUrlState({
    projectId: "proj",
    activeCompPath: null,
    duration: 10,
    isPlaying: false,
    compositionLoading: false,
    refreshKey: 0,
    previewIframeRef: { current: document.createElement("iframe") },
    rightPanelTab: "design",
    rightCollapsed: false,
    activeCompPathHydrated: true,
    domEditSelection: null,
    domEditGroupSelections: [],
    applyMarqueeSelection,
    buildDomSelectionFromTarget: async () => built,
    applyDomSelection,
    setRightPanelTab: vi.fn(),
    // A link with a selection and no time: the playhead stays at 0.
    initialState: {
      activeCompPath: null,
      currentTime: null,
      rightPanelTab: null,
      rightCollapsed: null,
      timelineVisible: null,
      selection,
    },
  });
  return null;
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

// happy-dom fires hashchange on replaceState, which browsers never do; only this file's own events pass.
const dropHashChange = (event: Event) => {
  if (!(event as Event & { fromTest?: boolean }).fromTest) event.stopImmediatePropagation();
};

beforeEach(() => {
  vi.useFakeTimers();
  window.addEventListener("hashchange", dropHashChange, { capture: true });
});

afterEach(() => {
  window.history.replaceState(null, "", "#");
  window.removeEventListener("hashchange", dropHashChange, { capture: true });
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useStudioUrlState selection retry", () => {
  it("restores a link's selection at playhead 0 when the frame answers on its second try", async () => {
    find.mockResolvedValueOnce(undefined).mockResolvedValue(element);
    root = mountReactHarness(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // While the lookup retries, the URL still carries the selection, so a reload keeps it.
    expect(window.location.hash).toContain("selId=s0");
    await flush();
    expect(find).toHaveBeenCalledTimes(2);
    expect(applyDomSelection).toHaveBeenCalledWith(built, { revealPanel: false });
  });

  it("asks a frame that never answers on a timer, not as fast as it replies", async () => {
    find.mockResolvedValue(undefined);
    root = mountReactHarness(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(find.mock.calls.length).toBeLessThanOrEqual(5);
    expect(applyDomSelection).not.toHaveBeenCalledWith(built, expect.anything());
  });

  it("finishes hydration when a newer link replaces a lookup that is still waiting", async () => {
    find.mockResolvedValue(undefined);
    root = mountReactHarness(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(window.location.hash).toContain("selId=s0");
    find.mockResolvedValue(element);
    await act(async () => {
      window.history.replaceState(null, "", window.location.hash.replace("selId=s0", "selId=s1"));
      window.dispatchEvent(Object.assign(new Event("hashchange"), { fromTest: true }));
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(applyDomSelection).toHaveBeenCalledWith(built, { revealPanel: false });
    expect(window.location.hash).not.toContain("selId=s0");
  });

  it("keeps a linked group member the frame answers for only on a later try", async () => {
    const member = document.createElement("div");
    let memberTries = 0;
    find.mockImplementation(async (_iframe, target) => {
      if (target.id !== "s1") return element;
      memberTries += 1;
      return memberTries > 1 ? member : undefined;
    });
    root = mountReactHarness(
      <Harness selection={{ sourceFile: "index.html", id: "s0", group: [{ id: "s1" }] }} />,
    );
    await flush();
    await flush();
    expect(memberTries).toBe(2);
    expect(applyMarqueeSelection).toHaveBeenCalledWith([built, built], "replace");
  });
});
