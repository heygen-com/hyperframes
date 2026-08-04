// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import type { UseDomSelectionParams } from "./useDomSelection";

const resolveDomEditSelection = vi.fn();

vi.mock("../components/editor/domEditing", () => ({
  resolveDomEditSelection: (...args: unknown[]) => resolveDomEditSelection(...args),
  findElementForSelection: () => null,
  findElementForTimelineElement: () => null,
}));
vi.mock("../components/editor/manualEdits", () => ({ reapplyPositionEditsAfterSeek: () => {} }));
vi.mock("./useStudioTestHooks", () => ({ useStudioTestHooks: () => {} }));

const { useDomSelection } = await import("./useDomSelection");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  resolveDomEditSelection.mockReset();
});

function paramsFor(suffix: string, selected: string[]): UseDomSelectionParams {
  return {
    projectId: `project-${suffix}`,
    activeCompPath: `compositions/${suffix}.html`,
    isMasterView: false,
    compIdToSrc: new Map([[suffix, `compositions/${suffix}.html`]]),
    captionEditMode: false,
    previewIframeRef: { current: null },
    timelineElements: [] as TimelineElement[],
    setSelectedTimelineElementId: (id) => selected.push(String(id)),
    setRightCollapsed: () => {},
    setRightPanelTab: () => {},
    previewIframe: null,
    refreshKey: 0,
    rightPanelTab: "design",
  };
}

const CALLBACKS = [
  "applyDomSelection",
  "clearDomSelection",
  "buildDomSelectionFromTarget",
  "resolveDomSelectionFromPreviewPoint",
  "resolveAllDomSelectionsFromPreviewPoint",
  "updateDomEditHoverSelection",
  "buildDomSelectionForTimelineElement",
  "handleTimelineElementSelect",
  "refreshDomEditSelectionFromPreview",
  "refreshDomEditGroupSelectionsFromPreview",
  "applyMarqueeSelection",
  "setActiveGroupElement",
] as const;

describe("useDomSelection retention", () => {
  /**
   * A `useCallback` rebuilt on a dep change is a new closure in the current
   * render's scope, while every callback whose deps did not change is an older
   * closure stored into that same scope — one edge chaining render N to render
   * N-1. A project switch changes projectId, activeCompPath and
   * timelineElements at once, so every switch added a link that pinned that
   * render's element snapshot forever. Stable identities are what stops it.
   */
  it("keeps every callback identity across a project switch, and still reads the new project", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const selected: string[] = [];
    let current: ReturnType<typeof useDomSelection> | null = null;

    function Harness({ params }: { params: UseDomSelectionParams }) {
      current = useDomSelection(params);
      return null;
    }

    await act(async () => {
      root.render(React.createElement(Harness, { params: paramsFor("alpha", selected) }));
    });
    const first = { ...current! };

    await act(async () => {
      root.render(React.createElement(Harness, { params: paramsFor("beta", selected) }));
    });
    const second = current!;

    for (const name of CALLBACKS) {
      expect(second[name], `${name} identity changed across the switch`).toBe(first[name]);
    }

    // Stability must not cost freshness: the once-built callback has to see the
    // project it was NOT created with.
    resolveDomEditSelection.mockResolvedValue(null);
    await act(async () => {
      await second.buildDomSelectionFromTarget(document.createElement("div"));
    });
    expect(resolveDomEditSelection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "project-beta",
        activeCompositionPath: "compositions/beta.html",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });
});
