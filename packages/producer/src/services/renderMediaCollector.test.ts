import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEDIA_RENDER_ID_ATTR } from "@hyperframes/core";
import { resolveTimelineExtractionWindow } from "@hyperframes/engine";
import { compileForRender } from "./htmlCompiler.js";
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

  it("closes a host authored with data-duration but no data-end", () => {
    // A slot shortened to 2s over a 4s scene file: the runtime hides the
    // scene's descendants past 2s, so the planner must stop its media there.
    const html =
      `<div data-composition-file="hook.html" data-composition-id="hook" data-start="0" data-duration="2">` +
      `<audio ${MEDIA_RENDER_ID_ATTR}="hook-sound" id="hook-sound" src="hook.m4a" data-start="0" data-duration="4" data-end="4"></audio>` +
      `<video ${MEDIA_RENDER_ID_ATTR}="late" id="late" src="late.mp4" data-start="2.5" data-duration="1" data-end="3.5"></video>` +
      `</div>` +
      `<div data-composition-file="body.html" data-composition-id="body" data-start="hook" data-duration="2">` +
      `<audio ${MEDIA_RENDER_ID_ATTR}="body-sound" id="body-sound" src="body.m4a" data-start="0" data-duration="4" data-end="4"></audio>` +
      `</div>`;

    const { videos, audios } = collectRenderMedia(html);
    expect(audios.find((a) => a.id === "hook-sound")).toMatchObject({ start: 0, end: 2 });
    expect(videos.find((v) => v.id === "late")).toBeUndefined();
    // A host whose start is an id-ref is bounded at resolved start + duration.
    expect(audios.find((a) => a.id === "body-sound")).toMatchObject({ start: 2, end: 4 });
  });

  it("prefers data-duration over a conflicting data-end, like the runtime", () => {
    // data-start 2 + data-duration 2 closes the host at 4 even though data-end
    // says 6; the runtime hides descendants at start + duration.
    const html =
      `<div data-composition-file="scene.html" data-composition-id="scene" data-start="2" data-duration="2" data-end="6">` +
      `<audio ${MEDIA_RENDER_ID_ATTR}="scene-sound" id="scene-sound" src="scene.m4a" data-start="0" data-duration="4" data-end="4"></audio>` +
      `<video ${MEDIA_RENDER_ID_ATTR}="scene-clip" id="scene-clip" src="scene.mp4" data-start="0" data-duration="4" data-end="4"></video>` +
      `</div>`;

    const { videos, audios } = collectRenderMedia(html);
    expect(audios.find((a) => a.id === "scene-sound")).toMatchObject({ start: 2, end: 4 });
    expect(videos.find((v) => v.id === "scene-clip")).toMatchObject({ start: 2, end: 4 });
  });

  it.each(["0", "-1"])(
    "treats a non-positive data-duration (%s) as absent instead of collapsing the host",
    (duration) => {
      const html =
        `<div data-composition-file="open.html" data-composition-id="open" data-start="1" data-duration="${duration}">` +
        `<video ${MEDIA_RENDER_ID_ATTR}="open-clip" id="open-clip" src="open.mp4" data-start="0" data-duration="3" data-end="3"></video>` +
        `</div>` +
        `<div data-composition-file="capped.html" data-composition-id="capped" data-start="1" data-duration="${duration}" data-end="3">` +
        `<video ${MEDIA_RENDER_ID_ATTR}="capped-clip" id="capped-clip" src="capped.mp4" data-start="0" data-duration="3" data-end="3"></video>` +
        `</div>`;

      const { videos } = collectRenderMedia(html);
      // No usable duration and no data-end: the host is unbounded, the clip keeps its own end.
      expect(videos.find((v) => v.id === "open-clip")).toMatchObject({ start: 1, end: 4 });
      // No usable duration: fall back to data-end.
      expect(videos.find((v) => v.id === "capped-clip")).toMatchObject({ start: 1, end: 3 });
    },
  );

  it("ignores a data-end at or before the host start instead of dropping nested media", () => {
    // The runtime treats an end that does not lie past the start as absent; the
    // planner must not collapse the window to hostStart and drop every clip.
    const html =
      `<div data-composition-file="scene.html" data-composition-id="scene" data-start="2" data-end="1">` +
      `<video ${MEDIA_RENDER_ID_ATTR}="scene-clip" id="scene-clip" src="scene.mp4" data-start="0" data-duration="3" data-end="3"></video>` +
      `</div>`;

    const { videos } = collectRenderMedia(html);
    expect(videos.find((v) => v.id === "scene-clip")).toMatchObject({ start: 2, end: 5 });
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
    expect(audios.find((audio) => audio.id === "local-audio")).toMatchObject({ start: 4, end: 6 });
    expect(audios.find((audio) => audio.id === "global-audio")).toMatchObject({ start: 2, end: 4 });
  });
});

async function compileProject(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "hf-media-"));
  try {
    for (const [name, html] of Object.entries(files)) writeFileSync(join(dir, name), html);
    return await compileForRender(dir, join(dir, "index.html"), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const inlineScene = (sceneTiming: string, extra = "") =>
  `<!doctype html><html><body>` +
  `<div id="root" data-composition-id="main" data-start="0" data-duration="12" data-width="1280" data-height="720">` +
  `<div id="scene" data-composition-id="scene" class="clip" ${sceneTiming}>` +
  `<video id="clip" class="clip" src="clip.mp4" data-start="0" data-duration="19" muted></video>` +
  `<audio id="vo" src="vo.m4a" data-start="0" data-duration="19"></audio>` +
  extra +
  `</div></div></body></html>`;

const media = (attrs: string) =>
  `<video ${MEDIA_RENDER_ID_ATTR}="clip" id="clip" src="clip.mp4" ${attrs}></video>` +
  `<audio ${MEDIA_RENDER_ID_ATTR}="vo" id="vo" src="vo.m4a" ${attrs}></audio>`;

describe("collectRenderMedia in-point hosts", () => {
  it("plays a head-trimmed scene's media from its in-point", () => {
    const html =
      `<div data-composition-id="scene" data-start="0" data-duration="12" data-playback-start="7">` +
      media(`data-start="0" data-duration="19" data-end="19"`) +
      `</div>`;

    const { videos, audios } = collectRenderMedia(html);
    const video = videos.find((v) => v.id === "clip")!;
    expect(video).toMatchObject({ start: 0, end: 12, mediaStart: 7 });
    expect(resolveTimelineExtractionWindow(video, video.end - video.start, 12)).toMatchObject({
      compositionStart: 0,
      mediaStart: 7,
      durationSeconds: 12,
    });
    expect(audios.find((a) => a.id === "vo")).toMatchObject({ start: 0, end: 12, mediaStart: 7 });
  });

  it("finds an inline in-point host in a compiled document with no sub-composition files", async () => {
    const { videos, audios } = await compileProject({
      "index.html": inlineScene(`data-start="0" data-duration="12" data-playback-start="7"`),
    });
    expect(videos.find((v) => v.id === "clip")).toMatchObject({ start: 0, end: 12, mediaStart: 7 });
    expect(audios.find((a) => a.id === "vo")).toMatchObject({ start: 0, end: 12, mediaStart: 7 });
  });

  it("starts an inline scene's media at the scene's start in a compiled document", async () => {
    const legacy = `<video id="legacy" src="l.mp4" data-start="6" data-duration="3" data-hf-media-start-basis="global" muted></video>`;
    const { videos, audios } = await compileProject({
      "index.html": inlineScene(`data-start="6" data-duration="6"`, legacy),
    });
    expect(videos.find((v) => v.id === "clip")).toMatchObject({ start: 6, end: 12, mediaStart: 0 });
    expect(audios.find((a) => a.id === "vo")).toMatchObject({ start: 6, end: 12, mediaStart: 0 });
    // Already root time: the scene's start is not added again.
    expect(videos.find((v) => v.id === "legacy")).toMatchObject({ start: 6, end: 9 });
  });

  it("leaves media running past the root composition's end uncut", () => {
    const html =
      `<div data-composition-id="main" data-start="0" data-duration="12">` +
      `<audio id="music" src="m.mp3" data-start="0" data-duration="19" data-end="19"></audio>` +
      `</div>`;

    expect(collectRenderMedia(html).audios[0]).toMatchObject({ start: 0, end: 19 });
  });

  it("places an in-point scene inside a later inline scene", () => {
    const html =
      `<div data-composition-id="outer" data-start="10" data-duration="10">` +
      `<div data-composition-id="inner" data-start="0" data-duration="5" data-playback-start="3">` +
      media(`data-start="0" data-duration="19" data-end="19"`) +
      `</div></div>`;

    const { videos, audios } = collectRenderMedia(html);
    expect(videos.find((v) => v.id === "clip")).toMatchObject({
      start: 10,
      end: 15,
      mediaStart: 3,
    });
    expect(audios.find((a) => a.id === "vo")).toMatchObject({ start: 10, end: 15, mediaStart: 3 });
  });

  it("keeps a looping video inside its in-point scene's slot", () => {
    const html =
      `<div data-composition-id="scene" data-start="2" data-duration="5" data-playback-start="3">` +
      `<video id="bg" src="bg.mp4" loop data-start="0" data-duration="10"></video>` +
      `</div>`;

    expect(collectRenderMedia(html).videos.find((v) => v.id === "bg")).toMatchObject({
      start: 2,
      end: 7,
      mediaStart: 0,
    });
  });

  it("never lets an author id take a render id's window", () => {
    const html =
      `<div data-composition-file="a.html" data-composition-id="a" data-start="5" data-duration="6">` +
      `<video ${MEDIA_RENDER_ID_ATTR}="clip" id="x" src="a.mp4" data-start="0" data-duration="12"></video>` +
      `</div>` +
      `<video id="clip" src="b.mp4" data-start="0" data-duration="3"></video>`;

    expect(collectRenderMedia(html).videos[0]).toMatchObject({ src: "a.mp4", start: 5, end: 11 });
  });

  it("skips an element the parsers do not report when matching author ids", () => {
    const html =
      `<div data-composition-id="main"><img id="clip">` +
      `<div data-composition-id="scene" data-start="5" data-duration="6">` +
      `<video id="clip" src="a.mp4" data-start="0" data-duration="12"></video>` +
      `</div></div>`;

    expect(collectRenderMedia(html).videos[0]).toMatchObject({ start: 5, end: 11 });
  });

  it("keeps a scene clip's window when a root element without a src shares its id", async () => {
    const { videos, images } = await compileProject({
      "index.html":
        `<!doctype html><html><body>` +
        `<div id="root" data-composition-id="main" data-start="0" data-duration="12" data-width="1280" data-height="720">` +
        `<div data-composition-src="a.html" data-start="5" data-duration="6"></div>` +
        `<img id="clip" data-start="0" data-duration="3"><img id="pic">` +
        `</div></body></html>`,
      "a.html":
        `<template><div data-composition-id="a" data-width="1280" data-height="720">` +
        `<video id="clip" src="clip.mp4" data-start="0" data-duration="12" muted></video>` +
        `<img id="pic" src="p.png" data-start="1" data-duration="2">` +
        `</div></template>`,
    });
    // The windows main exports for this project.
    expect(videos.find((v) => v.id === "clip")).toMatchObject({ start: 5, end: 11 });
    expect(images.find((i) => i.id === "pic")).toMatchObject({ start: 6, end: 8 });
  });

  it("cuts a split scene's media to the second half's slot", () => {
    const html =
      `<div data-composition-file="scene.html" data-composition-id="scene" data-start="5" data-duration="7" data-playback-start="5">` +
      media(`data-start="0" data-duration="12" data-end="12" data-playback-start="1"`) +
      `<audio ${MEDIA_RENDER_ID_ATTR}="early" id="early" src="early.m4a" data-start="1" data-duration="3" data-end="4"></audio>` +
      `<video ${MEDIA_RENDER_ID_ATTR}="early-clip" id="early-clip" src="early.mp4" data-start="1" data-duration="3"></video>` +
      `<audio ${MEDIA_RENDER_ID_ATTR}="fast" id="fast" src="fast.m4a" data-start="3" data-duration="20" data-end="23" data-playback-rate="2"></audio>` +
      `</div>`;

    const { videos, audios } = collectRenderMedia(html);
    expect(videos.find((v) => v.id === "clip")).toMatchObject({ start: 5, end: 12, mediaStart: 6 });
    expect(audios.find((a) => a.id === "vo")).toMatchObject({ start: 5, end: 12, mediaStart: 6 });
    // Wholly before the in-point: never played.
    expect(audios.find((a) => a.id === "early")).toBeUndefined();
    expect(videos.find((v) => v.id === "early-clip")).toBeUndefined();
    // Cut at the host's end, its 2 s head consumed at 2x.
    expect(audios.find((a) => a.id === "fast")).toMatchObject({ start: 5, end: 12, mediaStart: 4 });
  });

  it("reports the clips a split scene's in-point cuts away", async () => {
    const host = (timing: string) =>
      `<div data-composition-id="scene" data-composition-src="scene.html" ${timing}></div>`;
    const compiled = await compileProject({
      "index.html":
        `<!doctype html><html><body>` +
        `<div id="root" data-composition-id="main" data-start="0" data-duration="12" data-width="1280" data-height="720">` +
        host(`data-start="0" data-duration="5"`) +
        host(`data-start="5" data-duration="7" data-playback-start="5"`) +
        `</div></body></html>`,
      "scene.html":
        `<template><div data-composition-id="scene" data-width="1280" data-height="720">` +
        `<audio id="early" src="early.m4a" data-start="1" data-duration="3"></audio>` +
        `</div></template>`,
    });

    expect(compiled.audios.map(({ id, start, end }) => ({ id, start, end }))).toEqual([
      { id: "early", start: 1, end: 4 },
    ]);
    expect([...compiled.droppedMediaIds]).toEqual(["early__hf2"]);
  });

  it("changes nothing for a host without an in-point", () => {
    const scene = (inPoint: string) =>
      `<div data-composition-id="inline" data-start="3" data-duration="4"${inPoint}>` +
      media(`data-start="1" data-duration="9" data-end="10" data-playback-start="2"`) +
      `</div>` +
      `<div data-composition-file="scene.html" data-composition-id="scene" data-start="2" data-duration="6"${inPoint}>` +
      `<video ${MEDIA_RENDER_ID_ATTR}="nested" id="nested" src="n.mp4" data-start="1" data-duration="9" data-has-audio="true"></video>` +
      `</div>`;

    const absent = collectRenderMedia(scene(""));
    expect(collectRenderMedia(scene(` data-playback-start="0"`))).toEqual(absent);
    expect(absent.audios.find((a) => a.id === "nested-audio")).toMatchObject({
      start: 3,
      end: 8,
      mediaStart: 0,
    });
  });
});
