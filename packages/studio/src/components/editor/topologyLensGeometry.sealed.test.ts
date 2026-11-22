// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

vi.mock("../../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
}));
const sealed = vi.hoisted(() => ({ find: vi.fn(), scene: vi.fn(), rects: vi.fn() }));
vi.mock("../../webmcp/agentPreview", () => ({
  agentPreview: () => ({ find: sealed.find, scene: sealed.scene }),
}));
vi.mock("./previewOverlayRects", () => ({ measurePreviewVisibleRects: sealed.rects }));

import type { DomEditLayerItem } from "./domEditingTypes";
import { measureTopologyLensGeometry } from "./topologyLensGeometry";

const NESTED = "compositions/nested.html";
const item = (
  handle: string,
  tag: string,
  depth: number,
  sourceFile: string,
  dataAttributes: Record<string, string> = {},
): DomEditLayerItem => ({
  key: handle,
  element: document.createElement(tag),
  label: tag,
  tagName: tag,
  depth,
  childCount: 0,
  sourceFile,
  preview: { handle, zIndex: 0, kind: "element", dataAttributes },
});
const box = (left: number) => ({
  rect: { left, top: 0, width: 100, height: 50, editScaleX: 1, editScaleY: 1 },
  frame: { x: left, y: 0, width: 100, height: 50 },
  visible: true,
});

it("draws a sealed frame's lens from the frame's own geometry answer", async () => {
  sealed.scene.mockResolvedValue({
    status: "ready",
    drillInItem: null,
    items: [
      item("h-root", "main", 0, "index.html", { "data-composition-file": "index.html" }),
      item("h-host", "section", 1, "index.html", { "data-composition-file": NESTED }),
      item("h-context", "article", 2, NESTED),
      item("h-target", "div", 3, NESTED),
      item("h-child", "strong", 4, NESTED),
      item("h-aside", "aside", 3, NESTED),
    ],
  });
  sealed.find.mockResolvedValue({ handle: "h-target", tag: "div" });
  sealed.rects.mockResolvedValue([box(0), box(10), box(20), box(30)]);

  const geometry = await measureTopologyLensGeometry({
    overlay: document.createElement("div"),
    iframe: document.createElement("iframe"),
    activeCompositionPath: "index.html",
    handle: "dom:duplicate",
  });

  expect(sealed.rects).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
    "h-host",
    "h-target",
    "h-child",
    "h-aside",
  ]);
  expect(geometry?.field.label).toBe("section");
  expect(geometry?.target).toMatchObject({ label: "div", rect: { left: 10 } });
  expect(geometry?.contours.map((contour) => contour.label)).toEqual(["strong", "aside"]);
});
