// @vitest-environment jsdom
// fallow-ignore-file code-duplication
import { describe, expect, it, vi } from "vitest";
import {
  applyPreviewAudioFlags,
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
  it("labels a row from its own host when a sub-composition repeats the host's id", () => {
    const doc = makeDoc(`
      <div data-composition-id="main">
        <div data-composition-id="strip" data-composition-src="compositions/strip.html"><div id="scene"></div></div>
        <div id="scene" data-hf-id="hf-scene" data-composition-id="scene" data-composition-file="compositions/scene.html"></div>
      </div>
    `);
    const row = {
      id: "scene",
      key: "scene",
      tag: "div",
      start: 0,
      duration: 4,
      track: 0,
      hfId: "hf-scene",
    };
    const { updatedEls, patched } = buildMissingCompositionElements(
      doc,
      window as IframeWindow,
      [row],
      10,
    );
    expect([patched, updatedEls[0]?.compositionSrc]).toEqual([true, "compositions/scene.html"]);
  });

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

  it("carries the resolved track onto authoredTrack, so splitting a recovered composition host can't drift to a new row", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div
          data-composition-id="scene-c"
          data-composition-src="scenes/c.html"
          data-track-index="2"
          data-start="0"
          data-duration="5"
        ></div>
      </div>
    `);

    const { missing } = buildMissingCompositionElements(doc, window as IframeWindow, [], 10);
    const entry = missing[0];

    expect(entry).toBeDefined();
    expect(entry?.track).toBe(2);
    expect(entry?.authoredTrack).toBe(2);
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

    scrubPreviewAudio(iframe, 0.5, { id: "music" }, 0.4);

    expect(audio.volume).toBeCloseTo(0.1);
    stopScrubPreviewAudio();
  });

  /**
   * The preview document is a different realm, so `instanceof HTMLAudioElement`
   * is false for every node in it. That threw the `music` hint away and left
   * the first `<audio>` in the document as the only route — and the first
   * `<audio>` is often the voiceover, so scrubbing previewed the wrong track.
   * Two elements, music second, is what tells the two paths apart: with one
   * element the fallback reaches the right node by accident.
   */
  it("previews the track named by the music row, not the first audio in the document", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const previewDoc = iframe.contentDocument;
    if (!previewDoc?.body) throw new Error("expected an iframe document");

    const voiceover = previewDoc.createElement("audio");
    voiceover.id = "voiceover";
    voiceover.play = vi.fn(async () => {});
    voiceover.pause = vi.fn();

    const music = previewDoc.createElement("audio");
    music.id = "music-bed";
    music.play = vi.fn(async () => {});
    music.pause = vi.fn();

    previewDoc.body.append(voiceover, music);

    // The node really is cross-realm; this is the condition, not a contrivance.
    expect(music instanceof HTMLAudioElement).toBe(false);

    scrubPreviewAudio(iframe, 0.5, { id: "music-bed" }, 1);

    expect(music.play).toHaveBeenCalled();
    expect(voiceover.play).not.toHaveBeenCalled();
    stopScrubPreviewAudio();
  });

  it("previews the music row's own track when a sub-composition repeats its id", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const previewDoc = iframe.contentDocument;
    if (!previewDoc?.body) throw new Error("expected an iframe document");
    previewDoc.body.innerHTML =
      '<div data-composition-id="strip" data-composition-src="compositions/strip.html"><audio id="music"></audio></div>' +
      '<audio id="music" class="root"></audio>';
    const [inner, root] = Array.from(previewDoc.querySelectorAll("audio"));
    for (const audio of [inner, root])
      Object.assign(audio!, { play: vi.fn(async () => {}), pause: vi.fn() });

    scrubPreviewAudio(iframe, 0.5, { id: "music" }, 1);

    expect(root!.play).toHaveBeenCalled();
    expect(inner!.play).not.toHaveBeenCalled();
    stopScrubPreviewAudio();
  });

  /** A scrub audition is media running under a paused clock, which the runtime now
   *  stops on sight. So it borrows the element. That a leased element survives the
   *  tick is asserted runtime-side in core's `transportPark.test.ts`; here the
   *  contract is that the hook is called with the right element and given back. */
  it("borrows the element from the runtime for the audition and returns it on stop", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const previewDoc = iframe.contentDocument;
    if (!previewDoc?.body) throw new Error("expected an iframe document");

    const music = previewDoc.createElement("audio");
    music.id = "music";
    music.play = vi.fn(async () => {});
    music.pause = vi.fn();
    previewDoc.body.append(music);

    const leasePausedMedia = vi.fn();
    const releasePausedMedia = vi.fn();
    (previewDoc.defaultView as IframeWindow).__hf = { leasePausedMedia, releasePausedMedia };

    scrubPreviewAudio(iframe, 0.5, { id: "music" }, 1);

    expect(leasePausedMedia).toHaveBeenCalledWith(music);
    expect(releasePausedMedia).not.toHaveBeenCalled();

    stopScrubPreviewAudio();

    expect(releasePausedMedia).toHaveBeenCalledWith(music);
  });
});

describe("applyPreviewAudioFlags", () => {
  // Everything pushed here is state the runtime loses on reload and nothing else
  // re-sends, so the push has to carry all of it every time. Volume in
  // particular: the transport comes back at unity, so a preview the author had
  // turned down came back loud.
  it("re-pushes mute and volume together", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    applyPreviewAudioFlags(iframe, true, 0.4);

    const actions = postMessage.mock.calls.map(
      (call) => (call[0] as { action?: string }).action ?? "",
    );
    expect(actions).toContain("set-muted");
    expect(actions).toContain("set-volume");
  });
});
