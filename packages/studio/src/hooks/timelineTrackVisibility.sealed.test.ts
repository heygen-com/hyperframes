// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";

const sealed = vi.hoisted(() => ({
  edits: [] as Array<{ handle: string; edit: unknown; restore: ReturnType<typeof vi.fn> }>,
}));

vi.mock("../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
}));
vi.mock("../components/editor/previewSelection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/editor/previewSelection")>()),
  findOpaqueTimelineElement: vi.fn(async (_iframe: unknown, element: TimelineElement) => ({
    handle: `0123456789abcdef:${element.domId}`,
  })),
}));
vi.mock("../player/lib/previewElements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../player/lib/previewElements")>()),
  editPreviewElement: vi.fn((_iframe: unknown, handle: string, edit: unknown) => {
    const restore = vi.fn();
    sealed.edits.push({ handle, edit, restore });
    return { drawn: Promise.resolve(true), restore };
  }),
}));

import { toggleTimelineElementHidden } from "./timelineTrackVisibility";

afterEach(() => {
  sealed.edits.length = 0;
  vi.unstubAllGlobals();
  usePlayerStore.getState().reset();
});

const image: TimelineElement = {
  id: "qa-image",
  key: "index.html:#qa-image",
  domId: "qa-image",
  tag: "img",
  start: 0,
  duration: 2,
  track: 0,
};

function hide(writeProjectFile: (path: string, content: string) => Promise<void>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ content: '<img id="qa-image" data-start="0">' }), {
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
  return toggleTimelineElementHidden({
    projectId: "project-1",
    activeCompPath: "index.html",
    timelineElements: [image],
    elementKey: image.key!,
    hidden: true,
    previewIframe: document.createElement("iframe"),
    writeProjectFile,
    recordEdit: vi.fn(),
    pendingTimelineEditPathRef: { current: new Set() },
  });
}

it("hides the element in a sealed preview through its runtime, as an unsealed one is hidden in its page", async () => {
  await hide(async () => {});

  await vi.waitFor(() => expect(sealed.edits).toHaveLength(1));
  expect(sealed.edits[0]).toMatchObject({
    handle: "0123456789abcdef:qa-image",
    edit: { attributes: [["data-hidden", ""]] },
  });
});

it("puts a sealed preview's element back when the hide cannot be saved", async () => {
  await expect(
    hide(async () => {
      throw new Error("disk full");
    }),
  ).rejects.toThrow("disk full");

  await vi.waitFor(() => expect(sealed.edits[0]?.restore).toHaveBeenCalled());
});
