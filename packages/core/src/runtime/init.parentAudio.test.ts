import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";
import { parentCopyKey, parentCopyOf } from "../audibleVideo";

let now = 0;

function playingAudio(el: HTMLAudioElement) {
  let paused = true;
  Object.defineProperties(el, {
    duration: { value: 10, configurable: true },
    readyState: { value: 4, configurable: true },
    paused: { get: () => paused, configurable: true },
  });
  el.play = vi.fn(() => {
    paused = false;
    return Promise.resolve();
  });
  el.pause = vi.fn(() => void (paused = true));
  el.load = vi.fn();
}

function sealedFilm(extra = "") {
  resetRuntimeFixtureDom();
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="10">' +
    '<audio id="voice" data-start="0" data-duration="10" src="/voice.m4a"></audio>' +
    extra +
    "</div>";
  const voice = document.getElementById("voice") as HTMLAudioElement;
  playingAudio(voice);
  for (const el of document.querySelectorAll<HTMLAudioElement>("audio:not(#voice)"))
    playingAudio(el);
  window.__timelines = { main: createMockTimeline(10) };
  now = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  window.requestAnimationFrame = (cb) => (frames.set(++nextFrame, cb), nextFrame);
  window.cancelAnimationFrame = (id) => void frames.delete(id);
  const posted = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  initSandboxRuntimeModular();
  const playFor = (seconds: number) => {
    for (let ms = 0; ms < seconds * 1000; ms += 1000 / 60) {
      now += 1000 / 60;
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(now);
    }
  };
  const control = (action: string, extra: Record<string, unknown>) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: { source: "hf-parent", type: "control", action, ...extra },
      }),
    );
  return { voice, playFor, control, posted };
}

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
  delete window.__player;
});

// fails without the fix: a sealed film kept its own clock, so its picture ran apart from the parent's audio.
it("a sealed film's picture follows the parent's audio clock while it plays, and runs on from it after", () => {
  const { playFor, control } = sealedFilm();
  window.__player!.play();
  playFor(1);

  control("audio-clock", { time: 5, rate: 1, at: performance.timeOrigin + now });
  playFor(0.5);
  expect(window.__player!.getTime()).toBeCloseTo(5.5, 1);

  control("audio-clock", { time: null });
  playFor(0.5);
  expect(window.__player!.getTime()).toBeCloseTo(6, 1);
});

// fails without the fix: the film played its own copy of a clip the parent was already playing.
it("a clip the parent plays stays silent in the film, and is the film's again once the parent lets it go", () => {
  const { voice, playFor, control, posted } = sealedFilm();
  window.__player!.play();
  playFor(0.2);
  const copy = parentCopyOf(voice);
  if (!copy) throw new Error("expected a copy of the clip");

  control("set-parent-audio", { clips: [parentCopyKey(copy)] });
  playFor(0.2);
  expect(voice.muted).toBe(true);
  const lists = posted.mock.calls.filter(([message]) => message?.type === "parent-copies");
  expect(lists.at(-1)?.[0].media).toEqual([copy]);

  control("set-parent-audio", { clips: [] });
  playFor(0.2);
  expect(voice.muted).toBe(false);
});

// fails without the fix: two layers of one recording shared a claim; the dry copy silenced the processed one.
it("a claim silences only the layer the parent plays, not another layer of the same recording", () => {
  const { voice, playFor, control, posted } = sealedFilm(
    '<audio id="voice-fx" data-start="0" data-duration="10" src="/voice.m4a" data-fx-chain="[]"></audio>',
  );
  const processed = document.getElementById("voice-fx") as HTMLAudioElement;
  window.__player!.play();
  playFor(0.2);
  control("set-parent-audio", { clips: [] });
  playFor(0.2);
  const lists = posted.mock.calls.filter(([message]) => message?.type === "parent-copies");
  const media = lists.at(-1)?.[0].media as Parameters<typeof parentCopyKey>[0][];
  const dry = media.find(
    (copy) => !("data-fx-chain" in ((copy as { attrs?: object }).attrs ?? {})),
  );
  if (!dry || media.length !== 2) throw new Error("expected both layers listed");

  control("set-parent-audio", { clips: [parentCopyKey(dry)] });
  playFor(0.2);

  expect([voice.muted, processed.muted]).toEqual([true, false]);
});

// fails without the fix: removing the dry layer renumbered the processed one onto the dry layer's claim, silencing it.
it("a layer keeps its own claim when another layer of the same recording is removed", async () => {
  const { voice, playFor, control, posted } = sealedFilm(
    '<audio id="voice-fx" data-start="0" data-duration="10" src="/voice.m4a" data-fx-chain="[]"></audio>',
  );
  const processed = document.getElementById("voice-fx") as HTMLAudioElement;
  window.__player!.play();
  playFor(0.2);
  control("set-parent-audio", { clips: [] });
  playFor(0.2);
  const lists = () => posted.mock.calls.filter(([message]) => message?.type === "parent-copies");
  const first = lists().at(-1)?.[0].media as Parameters<typeof parentCopyKey>[0][];
  control("set-parent-audio", { clips: [parentCopyKey(first[0]!)] });
  playFor(0.2);

  voice.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
  playFor(0.2);

  const after = lists().at(-1)?.[0].media as Parameters<typeof parentCopyKey>[0][];
  expect(after.map(parentCopyKey)).toEqual([parentCopyKey(first[1]!)]);
  expect(processed.muted).toBe(false);
});

// fails without the fix: the parent played a mastered film's clips without its master chain.
it("marks every listed copy when the film routes its audio through a master chain", async () => {
  const { playFor, control, posted } = sealedFilm();
  document
    .querySelector("[data-composition-id]")!
    .setAttribute("data-fx-chain", '{"version":1,"nodes":[]}');
  await new Promise((resolve) => setTimeout(resolve, 0));
  window.__player!.play();
  playFor(0.2);
  control("set-parent-audio", { clips: [] });
  playFor(0.2);
  const lists = posted.mock.calls.filter(([message]) => message?.type === "parent-copies");
  const media = lists.at(-1)![0].media as { mastered?: boolean }[];
  expect(media.map((c) => c.mastered)).toEqual([true]);
});

// fails without the fix: a seek while the parent's clock held the film put the picture back on the old audio time.
it("a seek lets go of the parent's clock, so the picture lands where it was sent", () => {
  const { playFor, control } = sealedFilm();
  window.__player!.play();
  playFor(0.5);
  control("audio-clock", { time: 5, rate: 1, at: performance.timeOrigin + now });
  playFor(0.2);

  control("seek", { timeSeconds: 1 });
  window.__player!.play();
  playFor(0.2);

  expect(window.__player!.getTime()).toBeLessThan(2);
});
