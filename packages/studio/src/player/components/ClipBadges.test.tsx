// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { usePreviewIframeStore } from "../store/previewIframeStore";
import { ClipBadges } from "./ClipBadges";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  usePreviewIframeStore.getState().setIframe(null);
  document.body.innerHTML = "";
});

const talk: TimelineElement = {
  id: "talk",
  domId: "talk",
  tag: "video",
  start: 0,
  duration: 6,
  track: 0,
  hasAudio: true,
};

function render(el: TimelineElement) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<ClipBadges el={el} />));
}

const labels = () =>
  Array.from(document.querySelectorAll("[data-badge]")).map(
    (badge) => `${badge.getAttribute("data-badge")}:${badge.textContent}`,
  );

function mountPreview(html: string): Document {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("no iframe document");
  doc.body.innerHTML = html;
  usePreviewIframeStore.getState().setIframe(iframe);
  return doc;
}

describe("ClipBadges", () => {
  it("renders nothing for an untouched clip", () => {
    render(talk);
    expect(document.querySelector("[data-testid='clip-badges']")).toBeNull();
  });

  it("falls back to the store's volume without a preview", () => {
    render({ ...talk, volume: 1.8 });
    expect(labels()).toEqual(["volume:180%"]);
  });

  it("reads the live node and follows an agent's attribute edit", async () => {
    const doc = mountPreview(
      `<video id="talk" data-has-audio="true" data-link="talk-pair" style="clip-path: inset(10px)"></video>`,
    );
    render(talk);
    expect(labels()).toEqual(["link:🔗", "crop:Crop"]);
    const node = doc.getElementById("talk");
    await act(async () => {
      node?.setAttribute("data-color-grading", '{"preset":"warm-daylight","intensity":1}');
      node?.setAttribute("data-volume", "0.6");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(labels()).toEqual(["link:🔗", "look:Warm daylight", "crop:Crop", "more:+1"]);
    expect(document.querySelector("[data-badge='more']")?.getAttribute("title")).toBe("60%");
  });
});
