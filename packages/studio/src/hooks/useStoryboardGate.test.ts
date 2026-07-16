// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStoryboardGate } from "./useStoryboardGate";
import { StoryboardView } from "../components/storyboard/StoryboardView";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function renderGate(storyboardExists: boolean | "error") {
  const fetchStoryboard = vi.fn(async () => {
    if (storyboardExists === "error") throw new Error("network unavailable");
    return new Response(
      JSON.stringify({
        exists: storyboardExists,
        path: "STORYBOARD.md",
        globals: {},
        frames: [],
        warnings: [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchStoryboard);

  const setViewMode = vi.fn();
  const captured: { current: ReturnType<typeof useStoryboardGate> | null } = { current: null };

  function Probe() {
    const gate = useStoryboardGate("project-1", "storyboard", setViewMode);
    captured.current = gate;
    if (!gate.storyboard.error) return null;
    return createElement(StoryboardView, {
      ...gate.storyboard,
      projectId: "project-1",
      onSelectComposition: vi.fn(),
    });
  }

  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(Probe)));

  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
  expect(captured.current?.storyboard.loading).toBe(false);

  return { captured, host, setViewMode };
}

describe("useStoryboardGate", () => {
  it("keeps storyboard mode available when storyboard data exists", async () => {
    const { captured, setViewMode } = await renderGate(true);

    expect(captured.current?.storyboardAvailable).toBe(true);
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it("falls back to timeline when storyboard data does not exist", async () => {
    const { captured, setViewMode } = await renderGate(false);

    expect(captured.current?.storyboardAvailable).toBe(false);
    expect(setViewMode).toHaveBeenCalledTimes(1);
    expect(setViewMode).toHaveBeenCalledWith("timeline");
  });

  it("keeps the storyboard tab and retry view reachable when loading fails", async () => {
    const { captured, host, setViewMode } = await renderGate("error");

    expect(captured.current?.storyboardAvailable).toBe(true);
    expect(setViewMode).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Couldn’t load the storyboard: network unavailable");
    expect(
      [...host.querySelectorAll("button")].some((button) => button.textContent === "Retry"),
    ).toBe(true);
  });
});
