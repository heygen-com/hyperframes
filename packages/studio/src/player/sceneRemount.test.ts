// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { notePreviewReload, takePreviewReloadPaths, usePreviewReloadKey } from "./sceneRemount";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => void takePreviewReloadPaths());

describe("preview reload paths", () => {
  it("collects the scene files named before the reload runs", () => {
    notePreviewReload(["compositions/a.html"]);
    notePreviewReload(["compositions/b.html"]);
    expect(takePreviewReloadPaths()).toEqual(["compositions/a.html", "compositions/b.html"]);
    expect(takePreviewReloadPaths()).toBeNull();
  });

  it("reloads the whole film when any reload in the same batch names no files", () => {
    notePreviewReload(["compositions/a.html"]);
    notePreviewReload();
    notePreviewReload(["compositions/b.html"]);
    expect(takePreviewReloadPaths()).toBeNull();
  });

  it("usePreviewReloadKey: a plain setRefreshKey bump in the same batch turns a scene swap into a film reload", () => {
    let api: ReturnType<typeof usePreviewReloadKey> | null = null;
    const Probe = () => {
      api = usePreviewReloadKey();
      return null;
    };
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    act(() => api!.reloadPreview(["compositions/a.html"]));
    expect(api!.refreshKey).toBe(1);
    expect(takePreviewReloadPaths()).toEqual(["compositions/a.html"]);
    act(() => {
      api!.reloadPreview(["compositions/a.html"]);
      api!.setRefreshKey((key) => key + 1);
    });
    expect(api!.refreshKey).toBe(3);
    expect(takePreviewReloadPaths()).toBeNull();
    act(() => root.unmount());
  });
});
