// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const { previewRequest } = vi.hoisted(() => ({ previewRequest: vi.fn() }));
const PREVIEW_LOAD = vi.hoisted(() => ({}));
vi.mock("../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
  previewEditingClient: () => PREVIEW_LOAD,
  previewRequest,
  previewAnswer: previewRequest,
}));

import { applySoftReload } from "./gsapSoftReload";
import { frameGsap, frameQuery, settleGsapSnapshot } from "../hooks/gsapFrameSnapshot";
import { usePlayerStore } from "../player/store/playerStore";

const iframe = document.createElement("iframe");
const SAVED = `window.__timelines["main"] = gsap.timeline(); gsap.set("#b", { x: 5 });`;
const file = (script: string) =>
  `<div data-composition-id="main"><div id="a" style="opacity: 0.5"></div><div id="b"></div></div><script>${script}</script>`;
const PREVIOUS = file(
  `window.__timelines["main"] = gsap.timeline(); gsap.set("#a", { width: 300 });`,
);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  previewRequest.mockReset();
  delete (window as { __ran?: boolean }).__ran;
});

it("sends one request built only from the saved files: the saved script, its authored styles, what the old one set", () => {
  previewRequest.mockResolvedValue({ result: "applied" });

  const result = applySoftReload(iframe, SAVED, {
    authoredHtml: file(SAVED),
    previousHtml: PREVIOUS,
    currentTimeOverride: 2,
    onAsyncFailure: vi.fn(),
  });

  expect(result).toBe("applied");
  expect(previewRequest).toHaveBeenCalledOnce();
  const [, kind, params] = previewRequest.mock.calls[0]!;
  expect(kind).toBe("soft-reload");
  expect(params.script).toBe(SAVED);
  expect(params.time).toBe(2);
  expect(params.sets).toEqual([{ selector: "#a", props: ["width"] }]);
  expect(params.authored).toEqual(
    expect.arrayContaining([
      ["#a", "opacity: 0.5"],
      ["#b", ""],
    ]),
  );
  expect(Object.keys(params).sort()).toEqual([
    "authored",
    "restore",
    "script",
    "sets",
    "time",
    "timing",
  ]);
  expect([params.timing, params.restore]).toEqual([[], []]);
});

it.each([
  ["refuses", { result: "cannot-soft-reload" }, 1],
  ["does not answer", null, 1],
  ["answers with a script to run", { result: "applied", script: "window.__ran = true" }, 1],
  ["answers with an unknown result", { result: "window.__ran = true" }, 1],
  ["applied it", { result: "applied" }, 0],
  ["reads its timelines empty for now", { result: "verify-failed" }, 0],
])(
  "reloads the preview only when the frame did not apply it: the frame %s",
  async (_l, reply, reloads) => {
    previewRequest.mockResolvedValue(reply);
    const reload = vi.fn();

    applySoftReload(iframe, SAVED, {
      authoredHtml: file(SAVED),
      previousHtml: PREVIOUS,
      currentTimeOverride: 0,
      onAsyncFailure: reload,
    });
    await settle();

    expect(reload).toHaveBeenCalledTimes(reloads);
    expect((window as { __ran?: boolean }).__ran).toBeUndefined();
  },
);

it("asks for a full reload without sending anything when the file before the write is not known", () => {
  const result = applySoftReload(iframe, SAVED, {
    authoredHtml: file(SAVED),
    currentTimeOverride: 0,
  });

  expect(result).toBe("cannot-soft-reload");
  expect(previewRequest).not.toHaveBeenCalled();
});

// fails without the fix: Studio's copy of a sealed frame's GSAP values was read again only on a seek, a reload or an
// undo, so after a save's in-place rerun a second resize read the scale from before the first and saved it wrong.
it("reads the frame's GSAP values again once a saved script reruns in place", async () => {
  const shown = (scaleX: number) => ({
    time: 2,
    defaultEase: null,
    timelines: [{ id: "main", time: 2, defaultEase: null, tweens: [] }],
    globalTweens: [],
    targets: [{ handle: "0123456789abcdef:1", id: "b", className: "", values: { scaleX } }],
  });
  let scaleX = 1.125;
  previewRequest.mockImplementation(async (_frame: unknown, kind: string) =>
    kind === "gsap-snapshot" ? shown(scaleX) : { result: "applied" },
  );
  usePlayerStore.setState({ currentTime: 2, isPlaying: false });
  await settleGsapSnapshot(iframe);

  scaleX = 1.542;
  applySoftReload(iframe, SAVED, {
    authoredHtml: file(SAVED),
    previousHtml: PREVIOUS,
    currentTimeOverride: 2,
  });
  await settle();
  await settleGsapSnapshot(iframe);

  expect(frameGsap(iframe)?.getProperty(frameQuery(iframe, "#b")!, "scaleX")).toBe(1.542);
  const reads = () =>
    previewRequest.mock.calls.filter(([, kind]) => kind === "gsap-snapshot").length;
  expect(reads()).toBe(2);

  previewRequest.mockImplementation(async (_frame: unknown, kind: string) =>
    kind === "gsap-snapshot" ? shown(scaleX) : { result: "cannot-soft-reload" },
  );
  applySoftReload(iframe, SAVED, {
    authoredHtml: file(SAVED),
    previousHtml: PREVIOUS,
    currentTimeOverride: 2,
  });
  await settle();
  expect(reads()).toBe(2);
});
