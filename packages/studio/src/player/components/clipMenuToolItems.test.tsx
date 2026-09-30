// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";
import { useCropPresetBarStore } from "../../components/editor/cropPresetStore";
import { ClipMenuToolItems, type ClipMenuToolGroup } from "./clipMenuToolItems";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  useCropPresetBarStore.getState().close();
});

const video: TimelineElement = {
  id: "talk",
  tag: "video",
  start: 0,
  duration: 6,
  track: 0,
  hasAudio: true,
};

function renderItems(group: ClipMenuToolGroup, element: TimelineElement, currentTime = 2) {
  const setQuiet = vi.fn(
    async (_el: TimelineElement, _attr: string, _value: string | null, _label: string) => undefined,
  );
  const onClose = vi.fn();
  const freeze = vi.fn((_el: TimelineElement, _time: number) => undefined);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <TimelineEditProvider value={{ onSetElementAttributeQuiet: setQuiet, onFreezeFrame: freeze }}>
        <ClipMenuToolItems
          group={group}
          element={element}
          currentTime={currentTime}
          onClose={onClose}
        />
      </TimelineEditProvider>,
    );
  });
  return { setQuiet, onClose, freeze };
}

function openSubmenu(label: string) {
  const row = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (button) => button.textContent?.startsWith(label),
  );
  act(() => row?.click());
}

function pick(text: string) {
  const item = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  ).find((button) => button.textContent?.endsWith(text));
  act(() => item?.click());
}

describe("ClipMenuToolItems", () => {
  it("Voice writes a single-choice data-fx-chain on a video with sound", () => {
    const { setQuiet, onClose } = renderItems("sound", video);
    openSubmenu("Voice");
    pick("Clean");
    const [element, attr, value] = setQuiet.mock.calls[0] ?? [];
    expect(element).toBe(video);
    expect(attr).toBe("data-fx-chain");
    expect(String(value)).toContain('"fromPreset":"voice-clean"');
    expect(onClose).toHaveBeenCalled();
  });

  it("Voice None drops the attribute", () => {
    const { setQuiet } = renderItems("sound", video);
    openSubmenu("Voice");
    pick("None");
    expect(setQuiet.mock.calls[0]?.slice(1, 3)).toEqual(["data-fx-chain", null]);
  });

  it("has no Voice on a video without sound", () => {
    renderItems("sound", { ...video, hasAudio: false });
    expect(document.body.textContent).toBe("");
  });

  it("Look writes the preset form and None removes it", () => {
    const { setQuiet } = renderItems("picture", video);
    openSubmenu("Look");
    pick("Warm daylight");
    openSubmenu("Look");
    pick("None");
    expect(setQuiet.mock.calls.map((call) => call.slice(1, 3))).toEqual([
      ["data-color-grading", '{"preset":"warm-daylight","intensity":1}'],
      ["data-color-grading", null],
    ]);
  });

  it("Crop opens the preset bar for this clip", () => {
    renderItems("picture", video);
    const crop = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Crop",
    );
    act(() => crop?.click());
    expect(useCropPresetBarStore.getState().openFor).toEqual({ hfId: undefined, id: "talk" });
  });

  it("offers no picture tools on an audio clip", () => {
    renderItems("picture", { ...video, tag: "audio" });
    expect(document.body.textContent).toBe("");
  });

  it("Freeze frame calls the freeze mutation at the playhead on a video", () => {
    const { freeze } = renderItems("time", video, 3.2);
    const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]');
    expect(item?.textContent).toBe("Freeze frame");
    act(() => item?.click());
    expect(freeze).toHaveBeenCalledWith(video, 3.2);
  });

  it("Freeze frame is disabled outside the clip and absent on images", () => {
    renderItems("time", video, 9);
    expect(document.querySelector<HTMLButtonElement>('[role="menuitem"]')?.disabled).toBe(true);
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    renderItems("time", { ...video, tag: "img" });
    expect(document.body.textContent).toBe("");
  });
});
