// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldDisableTimelineWhileCompositionLoading, NLEProvider } from "./NLEContext";
import { useAssetPreviewStore } from "../../utils/assetPreviewStore";
import { installReactActEnvironment } from "../../hooks/domSelectionTestHarness";

installReactActEnvironment();

// Render NLEProvider into a fresh detached host and settle the mount effect.
async function mountNleProvider(props: {
  projectId: string;
  refreshKey?: number;
}): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await renderNleProvider(root, props);
  return { host, root };
}

// Re-render NLEProvider into an existing root and settle effects.
async function renderNleProvider(
  root: Root,
  props: { projectId: string; refreshKey?: number },
): Promise<void> {
  await act(async () => {
    root.render(React.createElement(NLEProvider, props, React.createElement("div")));
    await Promise.resolve();
  });
}

describe("timeline loading disable state", () => {
  it("disables the timeline while the composition loading overlay is visible", () => {
    expect(shouldDisableTimelineWhileCompositionLoading(true)).toBe(true);
  });

  it("reenables the timeline after composition loading finishes", () => {
    expect(shouldDisableTimelineWhileCompositionLoading(false)).toBe(false);
  });
});

describe("NLEProvider — asset preview scoping", () => {
  beforeEach(() => {
    // No project API in this unit test — stub fetch so the compIdToSrc mount
    // effect's request rejects quietly instead of hitting the network.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("no network in tests"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useAssetPreviewStore.getState().clearPreviewAsset();
  });

  it("clears a stale cross-project asset preview when the active project changes", async () => {
    const { host, root } = await mountNleProvider({ projectId: "project-a" });

    useAssetPreviewStore.getState().setPreviewAsset("assets/photo.png", "project-a");
    expect(useAssetPreviewStore.getState().previewAsset).toBe("assets/photo.png");

    await renderNleProvider(root, { projectId: "project-b" });

    // The overlay stays mounted across the project switch (EditorShell isn't
    // keyed by projectId) — the store itself must be the thing that clears.
    expect(useAssetPreviewStore.getState().previewAsset).toBeNull();
    expect(useAssetPreviewStore.getState().previewProjectId).toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it("does not clear the preview on a re-render that keeps the same projectId", async () => {
    const { host, root } = await mountNleProvider({ projectId: "project-a" });

    useAssetPreviewStore.getState().setPreviewAsset("assets/photo.png", "project-a");

    await renderNleProvider(root, { projectId: "project-a", refreshKey: 1 });

    expect(useAssetPreviewStore.getState().previewAsset).toBe("assets/photo.png");

    act(() => root.unmount());
    host.remove();
  });
});
