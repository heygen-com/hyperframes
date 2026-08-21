// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePopulateKeyframeCacheForFile } from "./useGsapTweenCache";
import { usePlayerStore } from "../player/store/playerStore";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function HookHost() {
  usePopulateKeyframeCacheForFile("demo", "index.html", 1);
  return null;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  usePlayerStore.setState({
    elements: [
      {
        id: "lab",
        tag: "div",
        start: 0,
        duration: 12,
        track: 1,
        compositionSrc: "compositions/keyframe-lab.html",
      },
    ] as never,
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  vi.unstubAllGlobals();
});

describe("usePopulateKeyframeCacheForFile", () => {
  it("loads every sub-composition file the timeline shows, not just the active one", async () => {
    // Keyframe lanes must be populated when the project opens. Fetching only the
    // active file left them empty until a clip from the sub-composition was
    // selected (which is the only thing that switched `sourceFile`).
    const urls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      urls.push(String(input));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ animations: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      root.render(<HookHost />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(urls.some((u) => u.endsWith("/index.html"))).toBe(true);
    expect(urls.some((u) => u.includes("keyframe-lab.html"))).toBe(true);
  });
});
