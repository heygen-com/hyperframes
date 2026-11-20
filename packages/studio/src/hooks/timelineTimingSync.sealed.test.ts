// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

const { previewRequest } = vi.hoisted(() => ({ previewRequest: vi.fn() }));
vi.mock("../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
  previewRequest,
}));

import { finishTimelineTimingFallback } from "./timelineTimingSync";

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
