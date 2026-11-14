import { afterEach, expect, it, vi } from "vitest";
import { mediaElementTime } from "./mediaClock";
import { initSandboxRuntimeModular } from "./init";
import { evictMediaSyncState } from "./media";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

const asked = vi.hoisted(() => ({ about: null as Set<Element> | null }));

vi.mock("./startResolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./startResolver")>();
  const noting =
    <A extends unknown[], R>(resolve: (el: Element, ...rest: A) => R) =>
    (el: Element, ...rest: A): R => {
      asked.about?.add(el);
      return resolve(el, ...rest);
    };
  return {
    ...actual,
    createRuntimeStartTimeResolver: (
      params: Parameters<typeof actual.createRuntimeStartTimeResolver>[0],
    ) => {
      const resolver = actual.createRuntimeStartTimeResolver(params);
      return {
        ...resolver,
        resolveStartForElement: noting(resolver.resolveStartForElement),
        resolveDurationForElement: noting(resolver.resolveDurationForElement),
        resolveMediaStartForElement: noting(resolver.resolveMediaStartForElement),
      };
    },
  };
});

/** A loaded, paused video whose `load()` starts it over at 0, as a browser's does. */
function loadedVideo(el: HTMLVideoElement) {
  Object.defineProperty(el, "duration", { value: 6.27, configurable: true });
  Object.defineProperty(el, "readyState", { value: 4, configurable: true });
  Object.defineProperty(el, "paused", { value: true, writable: true, configurable: true });
  el.play = vi.fn(() => Promise.resolve());
  el.pause = vi.fn();
  el.load = vi.fn(() => {
    el.currentTime = 0;
  });
}

function reloadClipPausedAt4s() {
  resetRuntimeFixtureDom();
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="6.27">' +
    '<video id="clip" data-start="0" data-duration="6.27" data-track-index="0" src="/clip.mp4"></video>' +
    '<video id="cutout" data-start="0" data-duration="6.27" data-track-index="2" muted src="/cutout.webm"></video>' +
    "</div>";
  const clip = document.getElementById("clip") as HTMLVideoElement;
  const cutout = document.getElementById("cutout") as HTMLVideoElement;
  loadedVideo(clip);
  loadedVideo(cutout);
  window.__timelines = { main: createMockTimeline(6.27) };
  initSandboxRuntimeModular();
  window.__player!.seek(4);
  expect(clip.currentTime).toBe(mediaElementTime(4));
  expect(cutout.currentTime).toBe(mediaElementTime(4));

  evictMediaSyncState(clip);
  clip.src = "/clip.mp4?hf-proxy=h264";
  clip.load();
  clip.dispatchEvent(new Event("loadedmetadata"));
  return { clip, cutout };
}

// When the clip's authoring proxy (or that copy's larger size) loaded while paused, the clip restarted at 0 and
// showed another moment of the person under the cutout.
it("a paused video that loads a new source goes back to the playhead, level with its stacked twin", () => {
  const { clip, cutout } = reloadClipPausedAt4s();
  expect(clip.currentTime).toBe(mediaElementTime(4));
  expect(cutout.currentTime).toBe(mediaElementTime(4));
});

it("leaves a render's videos to the render", () => {
  window.__HF_EXPORT_RENDER_SEEK_CONFIG = { fps: 30, fpsSource: "render-options" };
  const { clip } = reloadClipPausedAt4s();
  expect(clip.currentTime).toBe(0);
});

/** The film's shape: 10 scenes of 20 timed lines, 14 videos; scene 3's first video reloads `into` s in. */
function reloadInLongFilm(into: number) {
  resetRuntimeFixtureDom();
  const videos = (s: number, count: number) =>
    Array.from(
      { length: count },
      (_, v) =>
        `<video id="v${s}-${v}" data-start="${10 + v * 60}" data-duration="6.27" data-track-index="0" src="/v${s}-${v}.mp4"></video>`,
    ).join("");
  const scenes = Array.from({ length: 10 }, (_, s) => {
    const lines = Array.from(
      { length: 20 },
      (_, k) => `<div data-start="${k * 7}" data-duration="4" data-track-index="1">${k}</div>`,
    ).join("");
    return (
      `<div id="s${s}" data-composition-id="s${s}" data-start="${s * 141}" data-duration="141">` +
      `${lines}${videos(s, s < 4 ? 2 : 1)}</div>`
    );
  }).join("");
  document.body.innerHTML = `<div data-composition-id="main" data-root="true" data-duration="1410">${scenes}</div>`;
  document.querySelectorAll("video").forEach(loadedVideo);
  window.__timelines = { main: createMockTimeline(1410) };
  initSandboxRuntimeModular();
  window.__player!.seek(3 * 141 + 10 + into);
  const reloaded = document.getElementById("v3-0") as HTMLVideoElement;
  expect(reloaded.currentTime).toBeCloseTo(mediaElementTime(into), 6);

  evictMediaSyncState(reloaded);
  reloaded.load();
  asked.about = new Set();
  reloaded.dispatchEvent(new Event("loadedmetadata"));
  const otherClips = [...asked.about].filter(
    (el) => !el.hasAttribute("data-composition-id") && el !== reloaded,
  );
  asked.about = null;
  return { reloaded, otherClips };
}

// A long film reloads its clips one by one as the playhead nears them; each reload re-decided every
// timed element in the film, which froze a 23-minute, 10-scene film for seconds at a time.
it("a reloaded video is put back at the playhead without re-deciding the rest of the film", () => {
  const { reloaded, otherClips } = reloadInLongFilm(5);
  expect(reloaded.currentTime).toBe(mediaElementTime(5));
  expect(otherClips).toEqual([]);
});

it("a reloaded video a frame off the playhead is still put back on it", () => {
  const { reloaded } = reloadInLongFilm(0.1);
  expect(reloaded.currentTime).toBeCloseTo(mediaElementTime(0.1), 6);
});

afterEach(() => {
  asked.about = null;
  window.__hfRuntimeTeardown?.();
  delete window.__HF_EXPORT_RENDER_SEEK_CONFIG;
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});
