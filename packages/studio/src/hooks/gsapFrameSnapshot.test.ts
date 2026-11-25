// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("../player/lib/previewChannel", () => {
  const clients = new WeakMap<HTMLIFrameElement, object>();
  return {
    previewEditingClient: (iframe: HTMLIFrameElement) => {
      if (!clients.has(iframe)) clients.set(iframe, {});
      return clients.get(iframe);
    },
    previewFrameOpaque: () => true,
    previewRequest: request,
  };
});

import { usePlayerStore } from "../player/store/playerStore";
import { frameDocument, frameGsap, frameTimelines, settleGsapSnapshot } from "./gsapFrameSnapshot";

const HANDLE = "0123456789abcdef:1";
const tween = {
  targets: [HANDLE],
  vars: { x: 200 },
  start: 0,
  duration: 1,
  from: false,
  initted: true,
  parsed: [{ p: "x", s: 0, c: 200 }],
  parts: [],
};
const target = { handle: HANDLE, id: "box", className: "", values: { x: 120 } };
const snapshot = (over: Record<string, unknown> = {}) => ({
  time: 0.5,
  defaultEase: null,
  timelines: [{ id: "main", time: 0.5, defaultEase: null, tweens: [tween] }],
  globalTweens: [],
  targets: [target],
  ...over,
});

afterEach(() => {
  request.mockReset();
  usePlayerStore.setState({ currentTime: 0, isPlaying: false });
});

async function readReply(reply: unknown, holds = true) {
  usePlayerStore.setState({ currentTime: 0.5, isPlaying: false });
  request.mockResolvedValue(reply);
  const iframe = document.createElement("iframe");
  await expect(settleGsapSnapshot(iframe)).resolves.toBe(holds);
  return iframe;
}

it("holds a well-formed reply", async () => {
  const iframe = await readReply(snapshot());

  expect(Object.keys(frameTimelines(iframe) ?? {})).toEqual(["main"]);
  expect(frameDocument(iframe)?.getElementById("box")).not.toBeNull();
});

// fails without the fix: the frame's reply was used unchecked, so a malformed one threw or was held as is.
it.each([
  ["targets that are not a list", snapshot({ targets: null })],
  [
    "more targets than the frame may send",
    snapshot({ targets: Array.from({ length: 513 }, () => target) }),
  ],
  ["a value that is not a number", snapshot({ targets: [{ ...target, values: { x: "7" } }] })],
  ["no list of global tweens", snapshot({ globalTweens: undefined })],
  ["a global tween off its shape", snapshot({ globalTweens: [{ ...tween, targets: ["x"] }] })],
  [
    "a tween start that is not finite",
    snapshot({
      timelines: [
        { id: "main", time: 0.5, defaultEase: null, tweens: [{ ...tween, start: Number.NaN }] },
      ],
    }),
  ],
  ["a target that is not a handle", snapshot({ targets: [{ ...target, handle: "#box" }] })],
  ["an id past the text bound", snapshot({ targets: [{ ...target, id: "b".repeat(4_097) }] })],
  ["a reply that is not a record", "gsap"],
])("refuses %s and holds nothing", async (_name, reply) => {
  const iframe = await readReply(reply, false);

  expect(frameTimelines(iframe)).toBeNull();
  expect(frameDocument(iframe)).toBeNull();
});

it("keeps a timeline named __proto__ as a timeline, not the record's prototype", async () => {
  const iframe = await readReply(
    snapshot({ timelines: [{ id: "__proto__", time: 0.5, defaultEase: null, tweens: [tween] }] }),
  );

  expect(Object.keys(frameTimelines(iframe) ?? {})).toEqual(["__proto__"]);
});

// fails without the fix: a click waited on the read the first seek started, which holds that seek's time, so right
// after a second seek it found no GSAP values at the playhead and the add did nothing.
it("waits for a read at the playhead when a second seek lands while the first read is out", async () => {
  usePlayerStore.setState({ currentTime: 0.5, isPlaying: false });
  let answerFirst = (_reply: unknown) => {};
  request.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
  const atOne = { id: "main", time: 1, defaultEase: null, tweens: [tween] };
  request.mockResolvedValueOnce(snapshot({ time: 1, timelines: [atOne] }));
  const iframe = document.createElement("iframe");

  const first = settleGsapSnapshot(iframe);
  usePlayerStore.setState({ currentTime: 1 });
  const click = settleGsapSnapshot(iframe);
  answerFirst(snapshot());
  await Promise.all([first, click]);

  expect(request).toHaveBeenCalledTimes(2);
  expect(frameGsap(iframe)).not.toBeNull();
});
