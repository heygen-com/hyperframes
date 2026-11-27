// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { previewRequest } from "../../player/lib/previewChannel";
import { standInFor } from "./previewSelection";
import type { DomEditSelection } from "./domEditing";
import { applyManualOffsetDragDraft, createManualOffsetDragMember } from "./manualOffsetDrag";
import {
  CHROME_PLANE_ATTR,
  endChromeInFrameIfReleased,
  paintChromeInFrameWhile,
} from "./frameDragChrome";

vi.mock("../../player/lib/previewChannel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../player/lib/previewChannel")>();
  return { ...actual, previewRequest: vi.fn(actual.previewRequest) };
});
vi.mock("./domEditOverlayBasis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./domEditOverlayBasis")>()),
  computeOverlayRootScale: () => ({
    iframeRect: { left: 50, top: 30, width: 400, height: 200 },
    overlayRect: { left: 0, top: 0, width: 600, height: 300 },
    rootScaleX: 0.5,
    rootScaleY: 0.5,
  }),
}));

const chromeSent = (iframe: HTMLIFrameElement) =>
  vi
    .mocked(previewRequest)
    .mock.calls.filter(([frame, kind]) => frame === iframe && kind === "draft")
    .map(([, , params]) => (params as { chrome?: { nodes?: unknown[] } | null }).chrome);

let root: ShadowRoot | null = null;
beforeEach(() => {
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, init) {
    root = attach.call(this, init);
    return root;
  });
  document.body.innerHTML = `<main data-composition-id="main"><div id="card" style="width: 200px"></div></main>
    <div id="overlay"><div ${CHROME_PLANE_ATTR} style="position: absolute">
      <div data-dom-edit-chrome style="transform-origin: 60px 45px"><div data-dom-edit-selection-box
        style="left: 10px; top: 20px; width: 100px; height: 50px; border: 1px solid rgb(60, 230, 172)"></div>
      <canvas></canvas></div></div></div>`;
});
afterEach(() => {
  endChromeInFrameIfReleased();
  vi.mocked(previewRequest).mockClear();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const overlay = () => document.getElementById("overlay")!;
const plane = () => overlay().querySelector<HTMLElement>(`[${CHROME_PLANE_ATTR}]`)!;
const studioBox = () => overlay().querySelector<HTMLElement>("[data-dom-edit-selection-box]")!;
const frameHost = () => document.querySelector("html > [data-hf-ignore]");
const frameBox = () => root!.firstElementChild!.firstElementChild!.firstElementChild as HTMLElement;

async function sealedDrag() {
  const { iframe } = sealedPreviewFrame();
  const handle = (await queryPreviewElements(iframe, "#card"))!.matches[0]!.handle;
  const element = standInFor(iframe, (await describePreviewElements(iframe, [handle]))![0]!);
  const rect = { left: 10, top: 20, width: 100, height: 50, editScaleX: 1, editScaleY: 1 };
  const selection = { element } as DomEditSelection;
  const made = createManualOffsetDragMember({
    key: "k",
    selection,
    element,
    rect,
    gesture: "drag",
  });
  if (!made.ok) throw new Error(made.reason);
  return { iframe, member: made.member };
}

const frames = (n: number) =>
  new Promise<void>((done) => {
    const next = (left: number) => requestAnimationFrame(() => (left ? next(left - 1) : done()));
    next(n);
  });

// fails without the fix: a sealed drag's outline stayed in Studio, a compositor frame apart from the layer.
describe("a sealed drag's chrome", () => {
  it("is painted by the frame with each draft at that step's place, and Studio keeps only what is outside", async () => {
    const { iframe, member } = await sealedDrag();
    let held = true;
    paintChromeInFrameWhile(iframe, overlay(), () => held);
    applyManualOffsetDragDraft(member, 10, 0);
    await vi.waitFor(() => expect(frameHost()).not.toBeNull());
    await vi.waitFor(() => expect(plane().style.clipPath).toContain("evenodd"));
    expect(plane().style.clipPath).toContain("M50 30h400v200h-400Z");
    studioBox().style.left = "30px";
    applyManualOffsetDragDraft(member, 30, 0);
    await vi.waitFor(() => expect(frameBox().style.left).toBe("30px"));
    expect(frameBox().style.borderTopWidth).toBe("1px");
    const [first, ...later] = chromeSent(iframe);
    expect(first?.nodes).toHaveLength(1);
    expect(later.every((chrome) => chrome && !chrome.nodes)).toBe(true);

    held = false;
    endChromeInFrameIfReleased();
    expect(plane().style.clipPath).toBe("");
    expect(frameHost()).not.toBeNull();
    await frames(2);
    await vi.waitFor(() => expect(frameHost()).toBeNull());
  });

  it("is left to Studio when the frame would refuse the copy, and the drafts still land", async () => {
    plane().innerHTML = "<div></div>".repeat(70);
    const { iframe, member } = await sealedDrag();
    paintChromeInFrameWhile(iframe, overlay(), () => true);
    applyManualOffsetDragDraft(member, 10, 0);
    await vi.waitFor(() => expect(chromeSent(iframe).length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(document.getElementById("card")!.style.translate).not.toBe(""));
    expect([chromeSent(iframe)[0], frameHost(), plane().style.clipPath]).toEqual([
      undefined,
      null,
      "",
    ]);
  });

  it("goes back to Studio when a later copy would be refused, and the drafts still land", async () => {
    const { iframe, member } = await sealedDrag();
    paintChromeInFrameWhile(iframe, overlay(), () => true);
    applyManualOffsetDragDraft(member, 10, 0);
    await vi.waitFor(() => expect(plane().style.clipPath).toContain("evenodd"));
    plane().insertAdjacentHTML("beforeend", "<div></div>".repeat(70));
    applyManualOffsetDragDraft(member, 40, 0);
    await vi.waitFor(() => expect(chromeSent(iframe).at(-1)).toBeNull());
    await vi.waitFor(() =>
      expect(document.getElementById("card")!.style.translate).toContain("40"),
    );
    expect([frameHost(), plane().style.clipPath]).toEqual([null, ""]);
  });

  // fails without the fix: the frame dropped a place it had no copy for, and Studio stayed clipped with no outline.
  it("is sent whole again when the frame lost its copy mid-drag", async () => {
    const { iframe, member } = await sealedDrag();
    paintChromeInFrameWhile(iframe, overlay(), () => true);
    applyManualOffsetDragDraft(member, 10, 0);
    await vi.waitFor(() => expect(plane().style.clipPath).toContain("evenodd"));
    await previewRequest(iframe, "draft", { drafts: [], chrome: null });
    expect(frameHost()).toBeNull();
    studioBox().style.left = "50px";
    applyManualOffsetDragDraft(member, 40, 0);
    applyManualOffsetDragDraft(member, 50, 0);
    await vi.waitFor(() => expect(frameBox().style.left).toBe("50px"));
    await vi.waitFor(() => expect(plane().style.clipPath).toContain("evenodd"));
    expect(chromeSent(iframe).filter((chrome) => chrome?.nodes)).toHaveLength(2);
  });

  it("of a later drag stays when an earlier drag's release clears the frame", async () => {
    const { iframe, member } = await sealedDrag();
    let firstHeld = true;
    paintChromeInFrameWhile(iframe, overlay(), () => firstHeld);
    applyManualOffsetDragDraft(member, 10, 0);
    await vi.waitFor(() => expect(frameHost()).not.toBeNull());
    firstHeld = false;
    endChromeInFrameIfReleased();
    paintChromeInFrameWhile(iframe, overlay(), () => true);
    await frames(2);
    applyManualOffsetDragDraft(member, 20, 0);
    await vi.waitFor(() => expect(chromeSent(iframe).at(-1)?.nodes).toHaveLength(1));
    expect(chromeSent(iframe)).not.toContain(null);
    await vi.waitFor(() => expect(frameHost()).not.toBeNull());
  });
});
