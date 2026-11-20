// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const { previewRequest, studioApiFetch } = vi.hoisted(() => ({
  previewRequest: vi.fn(),
  studioApiFetch: vi.fn(),
}));
vi.mock("./lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/previewChannel")>()),
  previewFrameOpaque: () => true,
  previewRequest,
}));
vi.mock("../utils/studioApiFetch", () => ({ studioApiFetch }));

import {
  markScenesStale,
  onPreviewContentReplaced,
  SCENE_SWAP_MS,
  sceneSwapFor,
} from "./sceneSwap";

const iframe = document.createElement("iframe");
const PREVIEW = "<html><body>the rebuilt preview</body></html>";

beforeEach(() => {
  previewRequest.mockReset();
  studioApiFetch.mockReset();
  studioApiFetch.mockResolvedValue(new Response(PREVIEW));
});

it("swaps a sealed preview's scenes from the document Studio fetched, and says the content changed", async () => {
  previewRequest.mockResolvedValue({ swapped: true });
  const replaced = vi.fn();
  onPreviewContentReplaced(iframe, replaced);

  const swap = sceneSwapFor(iframe);
  await swap!("/preview/index.html?_t=1", () => true);

  expect(studioApiFetch).toHaveBeenCalledWith("/preview/index.html?_t=1", expect.anything());
  expect(previewRequest).toHaveBeenCalledExactlyOnceWith(
    iframe,
    "swap-scenes",
    { html: PREVIEW, timeoutMs: SCENE_SWAP_MS },
    SCENE_SWAP_MS,
  );
  expect(replaced).toHaveBeenCalledOnce();
});

it.each([
  ["refuses", { swapped: false, reason: "scenes were added or removed" }],
  ["does not answer", null],
  ["answers with an extra field", { swapped: true, html: "<script>x()</script>" }],
])("rejects, so the film reloads, when the frame %s", async (_label, reply) => {
  previewRequest.mockResolvedValue(reply);
  const replaced = vi.fn();
  onPreviewContentReplaced(iframe, replaced);

  await expect(sceneSwapFor(iframe)!("/preview/index.html", () => true)).rejects.toThrow(
    "the preview did not swap its scenes",
  );
  expect(replaced).not.toHaveBeenCalled();
});

it("sends nothing when a newer edit superseded the fetched document", async () => {
  await expect(sceneSwapFor(iframe)!("/preview/index.html", () => false)).rejects.toThrow(
    "superseded",
  );
  expect(previewRequest).not.toHaveBeenCalled();
});

it("marks a sealed preview's edited scenes stale through the frame", () => {
  markScenesStale(iframe, ["card.html"]);
  expect(previewRequest).toHaveBeenCalledExactlyOnceWith(iframe, "mark-scenes-stale", {
    files: ["card.html"],
  });
});
