// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

const { previewRequest } = vi.hoisted(() => ({ previewRequest: vi.fn() }));
const PREVIEW_LOAD = vi.hoisted(() => ({}));
vi.mock("../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
  previewEditingClient: () => PREVIEW_LOAD,
  previewRequest,
  previewAnswer: previewRequest,
}));

import { finishTimelineTimingFallback } from "./timelineTimingSync";
import { inOrder } from "./sealedTimingQueue";
import { usePlayerStore } from "../player/store/playerStore";

const script = (at: number) =>
  `var tl = gsap.timeline({ paused: true }); tl.to("#clip", { x: 100, duration: 1 }, ${at}); window.__timelines["main"] = tl;`;
// The move's attribute write landed first, so the GSAP rewrite's own pair differs only in its script.
const file = (at: number) =>
  `<div data-composition-id="main" data-duration="6"><div id="clip" data-start="3" data-duration="2"></div></div><script>${script(at)}</script>`;

it("takes a sealed timing edit's saved clip and film timing to the frame with the in-place sync", async () => {
  previewRequest.mockImplementation(async (_iframe: unknown, kind: string) =>
    kind === "soft-reload" ? { result: "applied" } : { result: "unchanged" },
  );
  const reloadPreview = vi.fn();

  await finishTimelineTimingFallback({
    iframe: document.createElement("iframe"),
    projectId: null,
    reloadPreview,
    gsapMutation: async () => ({
      mutated: true,
      scriptText: script(3),
      before: file(1),
      after: file(3),
    }),
    onGsapError: vi.fn(),
    rebindWhenUnmutated: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const retime = previewRequest.mock.calls.find(([, kind]) => kind === "live-retime");
  const softReload = previewRequest.mock.calls.find(([, kind]) => kind === "soft-reload");
  if (!retime || !softReload) throw new Error("the live retime and soft reload were not both sent");
  expect((retime[2] as { timing: unknown }).timing).toEqual(
    (softReload[2] as { timing: unknown }).timing,
  );
  const timing = (softReload[2] as { timing: Array<[string, string[][]]> }).timing;
  expect(timing.map(([, attributes]) => attributes)).toEqual([
    [["data-duration", "6"]],
    [
      ["data-start", "3"],
      ["data-duration", "2"],
    ],
  ]);
  expect(reloadPreview).not.toHaveBeenCalled();
});

it("a queued rebind takes the playhead the person scrubbed to while it waited", async () => {
  previewRequest.mockReset();
  previewRequest.mockImplementation(async () => ({ rebound: true }));
  const iframe = document.createElement("iframe");
  let release = () => {};
  inOrder(iframe, () => new Promise<void>((done) => (release = done)));
  usePlayerStore.setState({ currentTime: 1 });
  const reloadPreview = vi.fn();

  await finishTimelineTimingFallback({
    iframe,
    projectId: null,
    reloadPreview,
    onGsapError: vi.fn(),
    rebindWhenUnmutated: true,
  });
  usePlayerStore.setState({ currentTime: 4 });
  release();

  await vi.waitFor(() =>
    expect(previewRequest).toHaveBeenCalledWith(iframe, "rebind-timing", { time: 4 }),
  );
  expect(reloadPreview).not.toHaveBeenCalled();
});
