// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TIMELINE_COMPOSITION_MIME } from "../../utils/timelineCompositionDrop";
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
});

function mount(onSelect = vi.fn(), onAddToTimeline = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CompositionsTab
        projectId="demo"
        compositions={["compositions/headline.html"]}
        activeComposition={null}
        onSelect={onSelect}
        onAddToTimeline={onAddToTimeline}
      />,
    );
  });
  const card = host.querySelector<HTMLElement>('[draggable="true"]');
  if (!card) throw new Error("composition card did not render");
  return { host, card, onSelect, onAddToTimeline };
}

describe("composition card drag", () => {
  it("uses a cached image instead of eagerly mounting a live preview iframe", () => {
    const { host } = mount();
    const thumbnail = host.querySelector<HTMLImageElement>('img[src*="/thumbnail/"]');
    expect(thumbnail).not.toBeNull();
    expect(new URL(thumbnail?.src ?? "").searchParams.get("t")).toBe("3.00");
    expect(host.querySelector("iframe")).toBeNull();
  });

  it("shows a fallback when the cached thumbnail fails", () => {
    const { host } = mount();
    const thumbnail = host.querySelector<HTMLImageElement>('img[src*="/thumbnail/"]');
    if (!thumbnail) throw new Error("composition thumbnail did not render");

    act(() => thumbnail.dispatchEvent(new Event("error")));

    expect(host.textContent).toContain("Preview unavailable");
    expect(host.querySelector('img[src*="/thumbnail/"]')).toBeNull();
  });

  it("mounts one live preview only after sustained hover and removes it on leave", () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { host, card } = mount();
      act(() => {
        card.dispatchEvent(new Event("pointerover", { bubbles: true }));
        vi.advanceTimersByTime(300);
      });
      expect(host.querySelectorAll("iframe")).toHaveLength(1);

      act(() => {
        card.dispatchEvent(new Event("pointerout", { bubbles: true }));
      });
      expect(host.querySelector("iframe")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps ordinary click navigation", () => {
    const { card, onSelect } = mount();
    act(() => card.click());
    expect(onSelect).toHaveBeenCalledWith("compositions/headline.html");
  });

  it("emits only source identity and suppresses the click following a drag", () => {
    const { card, onSelect } = mount();
    const data = new Map<string, string>();
    const event = new Event("dragstart", { bubbles: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        effectAllowed: "none",
        setData: (type: string, value: string) => data.set(type, value),
      },
    });
    act(() => {
      card.dispatchEvent(event);
      card.click();
    });

    expect(JSON.parse(data.get(TIMELINE_COMPOSITION_MIME) ?? "null")).toEqual({
      sourcePath: "compositions/headline.html",
    });
    expect(card.className).toContain("select-none");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers pointer and keyboard add-at-playhead actions without opening the card", () => {
    const { host, onSelect, onAddToTimeline } = mount();
    const add = host.querySelector<HTMLButtonElement>(
      '[aria-label="Add headline to timeline at playhead"]',
    );
    if (!add) throw new Error("add action did not render");
    act(() => {
      add.click();
      add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      add.click();
    });

    expect(onAddToTimeline).toHaveBeenCalledTimes(2);
    expect(onAddToTimeline).toHaveBeenLastCalledWith("compositions/headline.html");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
