// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const { previewRequest } = vi.hoisted(() => ({ previewRequest: vi.fn() }));
vi.mock("../player/lib/previewChannel", async (importOriginal) => {
  const original = await importOriginal<typeof import("../player/lib/previewChannel")>();
  const { admittedAnswer } = await import("../../tests/previewAnswerMock");
  return {
    ...original,
    previewFrameOpaque: () => true,
    previewRequest,
    previewAnswer: admittedAnswer(previewRequest, original.PREVIEW_STALE),
  };
});

import { moveLiveTweens } from "./gsapLiveRetime";
import { SAVED_STATE_DEADLINE_MS } from "./sealedPreviewLedger";

const iframe = document.createElement("iframe");
const script = (start: number) =>
  [
    "var tl = gsap.timeline({ paused: true });",
    `tl.to("#a", { x: 100, duration: 1 }, ${start});`,
    'window.__timelines["t"] = tl;',
  ].join("\n");
const file = (text: string) => `<div id="a"></div><script>${text}</script>`;
const files = {
  before: file(script(0.5)),
  after: file(script(1.5)).replace('id="a"', 'id="a" data-start="1.5"'),
};

beforeEach(() => previewRequest.mockReset());

it("sends a sealed preview the move planned from the saved file before and after the edit", async () => {
  previewRequest.mockResolvedValue({ result: "moved" });
  const reload = vi.fn();

  expect(await moveLiveTweens(iframe, script(1.5), 2, reload, files)).toBe(true);

  expect(previewRequest).toHaveBeenCalledExactlyOnceWith(
    iframe,
    "live-retime",
    {
      key: "t",
      after: script(1.5),
      tweens: [
        {
          selector: "#a",
          start: 1.5,
          duration: 1,
          wasStart: 0.5,
          wasDuration: 1,
          moved: true,
          source: 0,
        },
      ],
      time: 2,
      timing: [[expect.any(String), [["data-start", "1.5"]]]],
    },
    SAVED_STATE_DEADLINE_MS,
  );
  expect(reload).not.toHaveBeenCalled();
});

it.each([
  ["moved nothing", { result: "unchanged" }, false, 0],
  ["failed halfway", { result: "failed" }, true, 1],
  ["does not answer", null, true, 1],
  ["answers with an extra field", { result: "moved", after: "x()" }, true, 1],
])("when the frame %s it re-runs or reloads instead", async (_l, reply, handled, reloads) => {
  previewRequest.mockResolvedValue(reply);
  const reload = vi.fn();

  expect(await moveLiveTweens(iframe, script(1.5), 0, reload, files)).toBe(handled);
  expect(reload).toHaveBeenCalledTimes(reloads);
});

it("leaves it to a re-run, sending nothing, when the file before the edit is not known", async () => {
  expect(await moveLiveTweens(iframe, script(1.5), 0, vi.fn(), { after: files.after })).toBe(false);
  expect(previewRequest).not.toHaveBeenCalled();
});
