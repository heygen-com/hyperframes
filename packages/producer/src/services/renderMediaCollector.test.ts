import { describe, expect, it } from "bun:test";
import { MEDIA_RENDER_ID_ATTR } from "@hyperframes/core";
import { collectRenderMedia } from "./renderMediaCollector.js";

describe("collectRenderMedia host windows", () => {
  it("schedules nested videos at resolved host id-ref windows", () => {
    const html =
      `<div data-composition-file="hook.html" data-composition-id="hook" data-start="0" data-duration="2">` +
      `<video ${MEDIA_RENDER_ID_ATTR}="red" id="red" src="red.mp4" data-start="0" data-duration="2"></video>` +
      `</div>` +
      `<div data-composition-file="body.html" data-composition-id="body" data-start="hook" data-duration="2">` +
      `<video ${MEDIA_RENDER_ID_ATTR}="blue" id="blue" src="blue.mp4" data-start="0" data-duration="2"></video>` +
      `</div>`;

    const { videos } = collectRenderMedia(html);
    expect(videos.find((v) => v.id === "red")).toMatchObject({ start: 0, end: 2 });
    expect(videos.find((v) => v.id === "blue")).toMatchObject({ start: 2, end: 4 });
  });

  it("preserves an explicitly marked legacy-global media window", () => {
    const html =
      `<div data-composition-file="scene.html" data-composition-id="scene" data-start="2" data-duration="6">` +
      `<video ${MEDIA_RENDER_ID_ATTR}="local" id="local" src="local.mp4" data-start="2" data-duration="2" data-has-audio="true"></video>` +
      `<video ${MEDIA_RENDER_ID_ATTR}="global" id="global" src="global.mp4" data-start="2" data-duration="2" data-hf-media-start-basis="global" data-has-audio="true"></video>` +
      `</div>`;

    const { videos, audios } = collectRenderMedia(html);
    expect(videos.find((video) => video.id === "local")).toMatchObject({ start: 4, end: 6 });
    expect(videos.find((video) => video.id === "global")).toMatchObject({ start: 2, end: 4 });
    // Open-ended tracks run to the host slot's end (2 + data-duration 6).
    expect(audios.find((audio) => audio.id === "local-audio")).toMatchObject({ start: 4, end: 8 });
    expect(audios.find((audio) => audio.id === "global-audio")).toMatchObject({ start: 2, end: 8 });
  });
});

function inlinedScene(hostStart: number, inPoint: number): string {
  return `<div data-composition-id="root" data-start="0">
  <div data-composition-id="scene" data-composition-file="scene.html"
       data-start="${hostStart}" data-end="${hostStart + 2}" data-playback-start="${inPoint}">
    <video id="scene-video" data-hf-render-id="scene-video" src="clip.mp4"
           data-start="1" data-end="5" data-duration="4"></video>
    <audio id="pre-audio" data-hf-render-id="pre-audio" src="early.wav"
           data-start="0" data-end="1" data-duration="1"></audio>
    <audio id="late-audio" data-hf-render-id="late-audio" src="late.wav"
           data-start="2" data-end="3" data-duration="1"></audio>
  </div>
</div>`;
}

describe("collectRenderMedia nested in-point", () => {
  it.each([
    { name: "mid-timeline slot", hostStart: 5, videoStart: 5, lateStart: 5.5 },
    { name: "slot at t=0", hostStart: 0, videoStart: 0, lateStart: 0.5 },
  ])("shifts media by the slot in-point ($name)", ({ hostStart, videoStart, lateStart }) => {
    const media = collectRenderMedia(inlinedScene(hostStart, 1.5));
    expect(media.videos).toContainEqual(
      expect.objectContaining({
        id: "scene-video",
        start: videoStart,
        end: hostStart + 2,
        origin: videoStart - 0.5,
        mediaStart: 0,
      }),
    );
    expect(media.audios).not.toContainEqual(expect.objectContaining({ id: "pre-audio" }));
    expect(media.audios).toContainEqual(
      expect.objectContaining({ id: "late-audio", start: lateStart, end: lateStart + 1 }),
    );
  });

  it("resolves a host data-start id-ref against a sibling clip", () => {
    const html = `<div data-composition-id="root" data-start="0">
  <video id="intro" data-hf-render-id="intro" src="intro.mp4"
         data-start="0" data-end="10" data-duration="10"></video>
  <div data-composition-id="scene" data-composition-file="scene.html"
       data-start="intro" data-duration="2">
    <video id="scene-video" data-hf-render-id="scene-video" src="clip.mp4"
           data-start="0" data-end="4" data-duration="4"></video>
  </div>
</div>`;
    const media = collectRenderMedia(html);
    // The host's data-duration bounds the slot: the 4s clip is cut at 12, not 14.
    expect(media.videos.find((v) => v.id === "scene-video")).toMatchObject({
      start: 10,
      origin: 10,
      end: 12,
    });
  });

  it("bounds nested audio by a host that only carries data-duration", () => {
    const html = `<div data-composition-id="root" data-start="0">
  <div data-composition-id="scene" data-composition-src="scene.html"
       data-start="1" data-duration="2" data-playback-start="1.5">
    <audio id="bed" data-hf-render-id="bed" src="bed.wav" data-start="0"></audio>
  </div>
</div>`;
    const media = collectRenderMedia(html);
    expect(media.audios.find((a) => a.id === "bed")).toMatchObject({
      start: 1,
      end: 3,
      origin: -0.5,
      mediaStart: 0,
    });
  });

  it("composes a host inside a host with each start in its parent's seconds", () => {
    // Pinned to the runtime's "two-level" case in init.test.ts: both sides must
    // land the clip at [6, 10].
    const html = `<div data-composition-id="root" data-start="0">
  <div data-composition-id="outer" data-composition-file="outer.html"
       data-start="5" data-end="20" data-playback-start="1">
    <div data-composition-id="inner" data-composition-file="inner.html"
         data-start="2" data-end="10">
      <video id="clip" data-hf-render-id="clip" src="clip.mp4" data-start="0" data-end="4"></video>
    </div>
  </div>
</div>`;
    const media = collectRenderMedia(html);
    expect(media.videos.find((v) => v.id === "clip")).toMatchObject({
      start: 6,
      origin: 6,
      end: 10,
    });
  });

  it("composes host playback-rate onto nested media", () => {
    const html = `<div data-composition-id="root" data-start="0">
  <div data-composition-id="scene" data-composition-file="scene.html"
       data-start="5" data-end="7" data-playback-rate="2">
    <video id="scene-video" data-hf-render-id="scene-video" src="clip.mp4"
           data-start="0" data-end="4" data-duration="4"></video>
  </div>
</div>`;
    const media = collectRenderMedia(html);
    expect(media.videos.find((v) => v.id === "scene-video")).toMatchObject({
      start: 5,
      end: 7,
      origin: 5,
      mediaStart: 0,
      playbackRate: 2,
    });
  });
});
