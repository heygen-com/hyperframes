// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player/store/playerStore";
import { LeftSidebar } from "./LeftSidebar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
(
  window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }
).happyDOM.settings.disableIframePageLoading = true;

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  usePlayerStore.setState({ thumbnailContentRevision: 0 });
});

describe("LeftSidebar root badge source", () => {
  it("derives the root badge from the filtered compositions list, not the raw file tree", () => {
    // `fileTree` still contains a non-composition index.html (a vendored preset)
    // that the server's filtered `compositions` list excludes — the exact shape
    // that mis-targeted the badge before this PR's fix.
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <LeftSidebar
          projectId="demo"
          compositions={["hero.html"]}
          assets={[]}
          fileTree={["index.html", "hero.html"]}
          activeComposition={null}
          onSelectComposition={vi.fn()}
        />,
      );
    });
    const cards = host.querySelectorAll<HTMLElement>('[draggable="true"]');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain("Root");
  });
});
