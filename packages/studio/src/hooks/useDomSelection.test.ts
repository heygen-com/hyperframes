// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { installReactActEnvironment, makeSelection } from "./domSelectionTestHarness";
import { useDomSelection } from "./useDomSelection";

installReactActEnvironment();

interface HarnessProps {
  activeCompPath: string | null;
  projectId: string | null;
  refreshKey: number;
}

function renderHarness(initialProps: HarnessProps): {
  current: () => ReturnType<typeof useDomSelection>;
  rerender: (props: HarnessProps) => void;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let currentHook: ReturnType<typeof useDomSelection> | null = null;

  function Harness(props: HarnessProps) {
    currentHook = useDomSelection({
      projectId: props.projectId,
      activeCompPath: props.activeCompPath,
      isMasterView: false,
      compIdToSrc: new Map(),
      captionEditMode: false,
      previewIframeRef: { current: null },
      timelineElements: [],
      setSelectedTimelineElementId: vi.fn(),
      setRightCollapsed: vi.fn(),
      setRightPanelTab: vi.fn(),
      previewIframe: null,
      refreshKey: props.refreshKey,
      rightPanelTab: "design",
    });
    return null;
  }

  const rerender = (props: HarnessProps) => {
    act(() => {
      root.render(React.createElement(Harness, props));
    });
  };

  rerender(initialProps);

  return {
    current: () => {
      if (!currentHook) throw new Error("Expected hook result");
      return currentHook;
    },
    rerender,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function setupSelectedHarness() {
  const element = document.createElement("div");
  element.id = "headline";
  const selection = makeSelection("Headline", element);
  const harness = renderHarness({
    activeCompPath: "intro.html",
    projectId: "project-1",
    refreshKey: 0,
  });
  act(() => harness.current().applyDomSelection(selection));
  return { selection, harness };
}

describe("useDomSelection", () => {
  it("clears a committed selection when the active composition path changes", () => {
    const { selection, harness } = setupSelectedHarness();
    expect(harness.current().domEditSelection).toBe(selection);

    harness.rerender({
      activeCompPath: "outro.html",
      projectId: "project-1",
      refreshKey: 0,
    });

    expect(harness.current().domEditSelection).toBe(null);
    harness.cleanup();
  });

  it("preserves a committed selection when composition identity is unchanged", () => {
    const { selection, harness } = setupSelectedHarness();
    harness.rerender({
      activeCompPath: "intro.html",
      projectId: "project-1",
      refreshKey: 1,
    });

    expect(harness.current().domEditSelection).toBe(selection);
    harness.cleanup();
  });

  it("preserves selection when clearing an already inactive group scope", () => {
    const { selection, harness } = setupSelectedHarness();
    act(() => harness.current().setActiveGroupElement(null));

    expect(harness.current().domEditSelection).toBe(selection);
    harness.cleanup();
  });

  it("preserves selection when entering the already active group scope", () => {
    const group = document.createElement("div");
    const child = document.createElement("span");
    child.id = "headline";
    group.append(child);
    const selection = makeSelection("Headline", child);
    const harness = renderHarness({
      activeCompPath: "intro.html",
      projectId: "project-1",
      refreshKey: 0,
    });

    act(() => harness.current().setActiveGroupElement(group));
    act(() => harness.current().applyDomSelection(selection));
    act(() => harness.current().setActiveGroupElement(group));

    expect(harness.current().domEditSelection).toBe(selection);
    harness.cleanup();
  });
});
