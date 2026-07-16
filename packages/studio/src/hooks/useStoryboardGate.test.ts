// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStoryboardGate } from "./useStoryboardGate";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function renderGate(storyboardExists: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            exists: storyboardExists,
            path: "STORYBOARD.md",
            globals: {},
            frames: [],
            warnings: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );

  const setViewMode = vi.fn();
  const captured: { current: ReturnType<typeof useStoryboardGate> | null } = { current: null };

  function Probe() {
    captured.current = useStoryboardGate("project-1", "storyboard", setViewMode);
    return null;
  }

  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(Probe)));

  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
  expect(captured.current?.storyboard.loading).toBe(false);

  return { captured, setViewMode };
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
});
