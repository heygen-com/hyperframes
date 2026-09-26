// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { copyTextToClipboard } from "../utils/clipboard";
import { useAskAgentModal, type UseAskAgentModalParams } from "./useAskAgentModal";

vi.mock("../utils/clipboard", () => ({ copyTextToClipboard: vi.fn(async () => true) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function selection(): DomEditSelection {
  const element = document.createElement("div");
  element.id = "title";
  element.textContent = "Title";
  return {
    element,
    id: "title",
    selector: "#title",
    selectorIndex: 0,
    label: "div#title",
    tagName: "div",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    textContent: "Title",
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {} as DomEditSelection["capabilities"],
  };
}

function renderHook(params: Partial<UseAskAgentModalParams>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const domEditSelection = selection();
  let current: ReturnType<typeof useAskAgentModal> | null = null;

  function Harness() {
    current = useAskAgentModal({
      projectId: "p",
      activeCompPath: "index.html",
      projectDir: "/tmp/p",
      projectIdRef: { current: "p" },
      showToast: () => {},
      domEditSelectionRef: { current: domEditSelection },
      domEditSelection,
      ...params,
    });
    return null;
  }

  act(() => root.render(<Harness />));
  return {
    get current() {
      if (!current) throw new Error("hook not rendered");
      return current;
    },
  };
}

describe("handleAgentModalSubmit", () => {
  it("hands the prompt to the host when it asks, and leaves the clipboard alone", async () => {
    const onAgentPrompt = vi.fn();
    const hook = renderHook({ onAgentPrompt });

    await act(async () => {
      await hook.current.handleAgentModalSubmit("make it red");
    });

    expect(onAgentPrompt).toHaveBeenCalledTimes(1);
    const prompt = onAgentPrompt.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("make it red");
    expect(prompt).toContain("Source file:");
    expect(copyTextToClipboard).not.toHaveBeenCalled();
    expect(hook.current.agentModalOpen).toBe(false);
    expect(hook.current.copiedAgentPrompt).toBe(false);
  });

  it("copies the prompt to the clipboard when no host takes it", async () => {
    const hook = renderHook({});

    await act(async () => {
      await hook.current.handleAgentModalSubmit("make it red");
    });

    expect(copyTextToClipboard).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(copyTextToClipboard).mock.calls[0]?.[0])).toContain("make it red");
    expect(hook.current.copiedAgentPrompt).toBe(true);
  });
});
