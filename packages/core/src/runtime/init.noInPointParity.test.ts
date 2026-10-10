import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { WebAudioTransport } from "./webAudioTransport";
import type { RuntimeTimelineLike } from "./types";
import {
  createMockTimeline,
  resetRuntimeFixtureDom,
  stubDuration,
} from "./runtimeSeekFixture.test-helpers";

// Guard: a project with no non-zero in-point plays exactly as before in-points existed. Every
// expected value below was recorded by running these fixtures against the pre-in-point runtime.

const ROOT_12 = `data-composition-id="main" data-root="true" data-duration="12"`;
const host = (attrs: string, inner: string) =>
  `<div class="clip" data-composition-file="compositions/scene.html" ${attrs}>${inner}</div>`;

interface Fixture {
  name: string;
  html: string;
  timelines?: Record<string, number>;
  sources?: Record<string, number>;
}

const FIXTURES: Fixture[] = [
  {
    name: "one level",
    html: `<div ${ROOT_12}>${host(`data-composition-id="s" data-start="2" data-duration="6"`, `<div><video id="v" data-start="1" data-duration="3" data-media-start="0.5"></video></div>`)}</div>`,
  },
  {
    name: "two levels",
    html: `<div ${ROOT_12}>${host(`data-composition-id="o" data-start="1" data-duration="8"`, host(`data-composition-id="i" data-start="1" data-duration="5"`, `<video id="v" data-start="0.5" data-duration="6"></video>`))}</div>`,
  },
  {
    name: "three levels",
    html: `<div ${ROOT_12}>${host(`data-composition-id="a" data-start="1" data-duration="10"`, host(`data-composition-id="b" data-start="1" data-duration="5"`, host(`data-composition-id="c" data-start="1"`, `<video id="v" data-start="0" data-duration="9"></video>`)))}</div>`,
  },
  {
    name: "root length from its own timeline",
    html: `<div data-composition-id="main" data-root="true">${host(`data-composition-id="s" data-start="0" data-duration="10"`, `<video id="v" data-start="0" data-duration="10"></video>`)}</div>`,
    timelines: { main: 2 },
  },
  {
    name: "host with data-end",
    html: `<div ${ROOT_12}>${host(`data-composition-id="s" data-start="1" data-end="4"`, `<video id="v" data-start="0" data-duration="6"></video>`)}</div>`,
  },
  {
    name: "relative start",
    html: `<div ${ROOT_12}>${host(`data-composition-id="s" data-start="2" data-duration="8"`, `<div id="x" data-start="0" data-duration="2"></div><video id="v" data-start="x + 1" data-duration="3"></video>`)}</div>`,
  },
  {
    name: "anonymous host",
    html: `<div ${ROOT_12}>${host(`data-start="1" data-duration="5" data-playback-start="0"`, `<div data-composition-id="scene" data-duration="12"><video id="v" data-start="4" data-duration="4"></video></div>`)}</div>`,
  },
  {
    name: "host under a different id",
    html: `<div ${ROOT_12}>${host(`id="montage" data-composition-id="montage" data-start="3" data-duration="5"`, `<div data-composition-id="scene-10"><video id="v" data-start="1" data-duration="6"></video></div>`)}</div>`,
  },
  {
    name: "root-time media",
    html: `<div ${ROOT_12}>${host(`data-composition-id="s" data-start="3" data-duration="6"`, `<video id="v" data-start="4" data-duration="3" data-hf-media-start-basis="global"></video>`)}</div>`,
  },
  {
    name: "looping clip",
    html: `<div ${ROOT_12}>${host(`data-composition-id="s" data-start="1" data-duration="10"`, `<video id="v" loop data-start="1" data-duration="8"></video>`)}</div>`,
    sources: { v: 3 },
  },
  {
    name: "faded clip",
    html: `<div ${ROOT_12}>${host(`data-composition-id="s" data-start="1" data-duration="10"`, `<video id="v" data-start="1" data-duration="6" data-fade-in="1" data-fade-out="2"></video>`)}</div>`,
  },
  {
    name: "audio, same and cross origin",
    html: `<div ${ROOT_12}>${host(`data-composition-id="s" data-start="2" data-duration="4"`, `<audio id="same" src="a.mp3" data-start="1" data-duration="5"></audio><audio id="cross" src="https://cdn.example.com/a.mp3" data-start="0.5"></audio>`)}</div>`,
  },
  {
    name: "scene trimmed shorter than its file",
    html: `<div ${ROOT_12}>${host(`id="scene" data-composition-id="scene" data-start="2" data-duration="3" data-playback-start="0"`, `<div data-composition-id="scene" data-duration="6"><video id="v" data-start="0"></video><audio id="cross" src="https://cdn.example.com/a.mp3" data-start="0"></audio></div>`)}</div>`,
    timelines: { scene: 6 },
  },
];

const SAMPLES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];
const round = (value: number | undefined) =>
  value != null && Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : String(value);

function mount(fixture: Fixture) {
  document.body.innerHTML = fixture.html;
  for (const media of document.querySelectorAll<HTMLMediaElement>("video, audio")) {
    stubDuration(media, fixture.sources?.[media.id] ?? 30);
    Object.defineProperty(media, "currentTime", { value: -1, writable: true, configurable: true });
    media.load = () => {};
    media.play = vi.fn(() => Promise.resolve());
    media.pause = vi.fn();
  }
  window.__timelines = Object.fromEntries(
    Object.entries({ main: 12, ...fixture.timelines }).map(([id, seconds]) => [
      id,
      createMockTimeline(seconds),
    ]),
  ) as Record<string, RuntimeTimelineLike>;
}

/** Start, then source time and volume at each sample, then what play() hands the audio transport. */
async function record(fixture: Fixture) {
  mount(fixture);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(WebAudioTransport.prototype, "decodeAudioElement").mockResolvedValue({} as AudioBuffer);
  const capture = vi
    .spyOn(WebAudioTransport.prototype, "scheduleMediaElementPlayback")
    .mockResolvedValue(null);
  const decoded = vi.spyOn(WebAudioTransport.prototype, "schedulePlayback").mockResolvedValue(null);
  initSandboxRuntimeModular();
  // The audio transport comes up on a microtask, as in startPlayback (init.test.ts).
  await Promise.resolve();
  const media = [...document.querySelectorAll<HTMLMediaElement>("video, audio")];
  const trace: Record<string, unknown[]> = {};
  for (const el of media) trace[el.id] = [round(window.__hfResolveMediaStartSeconds?.(el))];
  for (const t of SAMPLES) {
    window.__player?.renderSeek(t);
    for (const el of media) trace[el.id]!.push([round(el.currentTime), round(el.volume)]);
  }
  window.__player?.renderSeek(0);
  window.__player?.play();
  const audio = media.filter((el) => el.tagName === "AUDIO");
  if (audio.length > 0) await vi.waitFor(() => expect(decoded).toHaveBeenCalledTimes(audio.length));
  return {
    trace,
    capture: capture.mock.calls.map(([el, start, mediaStart]) => [el.id, round(start), mediaStart]),
    decoded: decoded.mock.calls.map(([el, , start, mediaStart, , , , rate, clipDuration]) => [
      el.id,
      round(start),
      mediaStart,
      rate,
      round(clipDuration),
    ]),
  };
}

const EXPECTED: Record<string, unknown> = {
  "one level": {
    trace: {
      v: [
        3,
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [1, 1],
        [2, 1],
        [3, 1],
        [3, 1],
        [3, 1],
        [3, 1],
        [3, 1],
        [3, 1],
        [3, 1],
      ],
    },
    capture: [],
    decoded: [],
  },
  "two levels": {
    trace: {
      v: [
        2.5,
        [-1, 1],
        [-1, 1],
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 1],
        [4, 1],
        [4, 1],
        [4, 1],
        [4, 1],
        [4, 1],
      ],
    },
    capture: [],
    decoded: [],
  },
  "three levels": {
    trace: {
      v: [
        3,
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [3.5, 1],
        [4.5, 1],
        [5.5, 1],
        [6.5, 1],
        [7.5, 1],
        [8.5, 1],
      ],
    },
    capture: [],
    decoded: [],
  },
  "root length from its own timeline": {
    trace: {
      v: [
        0,
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [3.5, 1],
        [4.5, 1],
        [5.5, 1],
        [6.5, 1],
        [7.5, 1],
        [8.5, 1],
        [9.5, 1],
        [10, 1],
        [10, 1],
      ],
    },
    capture: [],
    decoded: [],
  },
  "host with data-end": {
    trace: {
      v: [
        1,
        [-1, 1],
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
      ],
    },
    capture: [],
    decoded: [],
  },
  "relative start": {
    trace: {
      v: [
        5,
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
      ],
    },
    capture: [],
    decoded: [],
  },
  "anonymous host": {
    trace: {
      v: [
        5,
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [3.5, 1],
        [3.5, 1],
        [3.5, 1],
        [3.5, 1],
      ],
    },
    capture: [],
    decoded: [],
  },
  "host under a different id": {
    trace: {
      v: [
        4,
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [3.5, 1],
        [4.5, 1],
        [5.5, 1],
        [5.5, 1],
        [5.5, 1],
      ],
    },
    capture: [],
    decoded: [],
  },
  "root-time media": {
    trace: {
      v: [
        4,
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
      ],
    },
    capture: [],
    decoded: [],
  },
  "looping clip": {
    trace: {
      v: [
        2,
        [-1, 1],
        [-1, 1],
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [0.5, 1],
        [1.5, 1],
        [1.5, 1],
        [1.5, 1],
      ],
    },
    capture: [],
    decoded: [],
  },
  "faded clip": {
    trace: {
      v: [
        2,
        [-1, 1],
        [-1, 1],
        [0.5, 0.5],
        [1.5, 1],
        [2.5, 1],
        [3.5, 1],
        [4.5, 0.75],
        [5.5, 0.25],
        [5.5, 0.25],
        [5.5, 0.25],
        [5.5, 0.25],
        [5.5, 0.25],
      ],
    },
    capture: [],
    decoded: [],
  },
  "audio, same and cross origin": {
    trace: {
      same: [
        3,
        [-1, 1],
        [-1, 1],
        [-1, 1],
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
        [2.5, 1],
      ],
      cross: [
        2.5,
        [-1, 1],
        [-1, 1],
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
        [3, 1],
        [3, 1],
        [3, 1],
        [3, 1],
        [3, 1],
        [3, 1],
      ],
    },
    capture: [["same", 3, 0]],
    decoded: [
      ["same", 3, 0, 1, 3],
      ["cross", 2.5, 0, 1, 3.5],
    ],
  },
  "scene trimmed shorter than its file": {
    trace: {
      v: [
        2,
        [-1, 1],
        [-1, 1],
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [3.5, 1],
        [4.5, 1],
        [5.5, 1],
        [5.5, 1],
        [5.5, 1],
        [5.5, 1],
        [5.5, 1],
      ],
      cross: [
        2,
        [-1, 1],
        [-1, 1],
        [0.5, 1],
        [1.5, 1],
        [2.5, 1],
        [3.5, 1],
        [4.5, 1],
        [5.5, 1],
        [5.5, 1],
        [5.5, 1],
        [5.5, 1],
        [5.5, 1],
      ],
    },
    capture: [],
    decoded: [["cross", 2, 0, 1, 6]],
  },
};

describe("a project with no in-point", () => {
  const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;
  beforeEach(() => {
    resetRuntimeFixtureDom();
    (globalThis as Record<string, unknown>).AudioContext = class {
      state = "running";
      destination = {};
      currentTime = 0;
      resume = () => Promise.resolve();
      suspend = () => Promise.resolve();
      createGain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
      createMediaElementSource = () => ({ connect() {}, disconnect() {} });
    };
  });
  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
    delete window.__player;
    delete window.__playerReady;
    delete window.__hf;
  });

  it.each(FIXTURES)("plays $name as before in-points", async (fixture) => {
    expect(await record(fixture)).toEqual(EXPECTED[fixture.name]);
  });
});
