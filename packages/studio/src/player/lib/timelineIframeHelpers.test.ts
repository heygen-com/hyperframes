// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  buildMissingCompositionElements,
  scrubPreviewAudio,
  setPreviewMediaVolume,
  stopScrubPreviewAudio,
} from "./timelineIframeHelpers";
import type { IframeWindow } from "./playbackTypes";

function makeDoc(html: string): Document {
  const d = document.implementation.createHTMLDocument();
  d.body.innerHTML = html;
  return d;
}

describe("buildMissingCompositionElements — hfId (R7)", () => {
  it("harvests hfId from data-hf-id on composition host elements", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div
          data-composition-id="scene-a"
          data-composition-src="scenes/a.html"
          data-hf-id="hf-scene1"
          data-start="0"
          data-duration="5"
        ></div>
      </div>
    `);

    const { missing } = buildMissingCompositionElements(doc, window as IframeWindow, [], 10);
    const entry = missing[0];

    expect(entry).toBeDefined();
    expect(entry?.hfId).toBe("hf-scene1");
  });

  it("leaves hfId undefined when element has no data-hf-id", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div
          data-composition-id="scene-b"
          data-composition-src="scenes/b.html"
          data-start="0"
          data-duration="5"
        ></div>
      </div>
    `);

    const { missing } = buildMissingCompositionElements(doc, window as IframeWindow, [], 10);
    const entry = missing[0];

    expect(entry).toBeDefined();
    expect(entry?.hfId).toBeUndefined();
  });
});

describe("setPreviewMediaVolume", () => {
  it("sends a clamped runtime volume to a direct preview iframe", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    setPreviewMediaVolume(iframe, 1.5);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: "set-volume", volume: 1 }),
      "*",
    );
  });
});

describe("scrubPreviewAudio", () => {
  it("scales scrub feedback by the Studio preview volume", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const audio = iframe.contentDocument?.createElement("audio");
    if (!audio || !iframe.contentDocument?.body) throw new Error("expected iframe audio document");
    audio.id = "music";
    audio.play = vi.fn(async () => {});
    audio.pause = vi.fn();
    iframe.contentDocument.body.append(audio);

    scrubPreviewAudio(iframe, 0.5, "music", 0.4);

    expect(audio.volume).toBeCloseTo(0.1);
    stopScrubPreviewAudio();
  });
});
