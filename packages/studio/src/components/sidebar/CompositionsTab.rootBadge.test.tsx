// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player/store/playerStore";
import { resolveMasterCompositionPath } from "../../utils/studioUrlState";
import { CompositionsTab } from "./CompositionsTab";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
(
  window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }
).happyDOM.settings.disableIframePageLoading = true;

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  usePlayerStore.setState({ thumbnailRevisions: {} });
});

function mount(compositions: string[], masterCompositionPath: string | null) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CompositionsTab
        projectId="demo"
        compositions={compositions}
        activeComposition={null}
        masterCompositionPath={masterCompositionPath}
        onSelect={vi.fn()}
      />,
    );
  });
  return host;
}

describe("CompositionsTab card thumbnails", () => {
  it("waits for the live preview to boot and keeps them through edit reloads", () => {
    usePlayerStore.getState().reset();
    const host = mount(["index.html"], "index.html");
    expect(host.querySelector("img")).toBeNull();

    act(() => usePlayerStore.getState().markPreviewBooted());
    expect(host.querySelector("img")?.getAttribute("src")).toContain("/thumbnail/index.html");

    act(() => usePlayerStore.getState().setTimelineReady(false));
    expect(host.querySelector("img")).not.toBeNull();
  });
});

describe("CompositionsTab root badge", () => {
  it("marks the composition matching masterCompositionPath as root", () => {
    const compositions = ["index.html", "compositions/headline.html"];
    const host = mount(compositions, resolveMasterCompositionPath(compositions));
    const cards = host.querySelectorAll<HTMLElement>('[draggable="true"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("Root");
    expect(cards[1]?.textContent).not.toContain("Root");
  });

  it("marks nothing as root when masterCompositionPath is null", () => {
    const compositions = ["compositions/hero.html", "compositions/outro.html"];
    const host = mount(compositions, null);
    const cards = host.querySelectorAll<HTMLElement>('[draggable="true"]');
    expect(cards[0]?.textContent).not.toContain("Root");
    expect(cards[1]?.textContent).not.toContain("Root");
  });
});
