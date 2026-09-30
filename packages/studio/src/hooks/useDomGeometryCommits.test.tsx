// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  applyStudioBoxSize,
  applyStudioPathOffset,
  applyStudioRotation,
  readStudioBoxSize,
  readStudioPathOffset,
  readStudioRotation,
} from "../components/editor/manualEdits";
import { useDomGeometryCommits, type UseDomGeometryCommitsParams } from "./useDomGeometryCommits";
import { DomEditCropHandles } from "../components/editor/DomEditCropHandles";
import { withInlineLayoutBox } from "./domSelectionTestHarness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountCommits(
  commitPositionPatchToHtml: UseDomGeometryCommitsParams["commitPositionPatchToHtml"],
  readOnlyPreview = false,
) {
  let commits: ReturnType<typeof useDomGeometryCommits> | null = null;
  function Probe() {
    commits = useDomGeometryCommits({
      previewIframeRef: { current: null },
      showToast: vi.fn(),
      commitPositionPatchToHtml,
      readOnlyPreview,
    });
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Probe />));
  return { commits: () => commits!, unmount: () => act(() => root.unmount()) };
}

describe("useDomGeometryCommits rollback", () => {
  it("restores every optimistic geometry mutation when persistence rejects", async () => {
    const element = document.createElement("div");
    element.id = "box";
    document.body.append(element);
    applyStudioPathOffset(element, { x: 10, y: 20 });
    applyStudioBoxSize(element, { width: 100, height: 80 });
    applyStudioRotation(element, { angle: 15 });
    const selection = {
      id: "box",
      selector: "#box",
      element,
    } as unknown as DomEditSelection;
    const failure = new Error("save failed");
    const commitPositionPatchToHtml = vi
      .fn<UseDomGeometryCommitsParams["commitPositionPatchToHtml"]>()
      .mockRejectedValue(failure);
    let commits: ReturnType<typeof useDomGeometryCommits> | null = null;
    const host = document.createElement("div");
    const root = createRoot(host);

    function Probe() {
      commits = useDomGeometryCommits({
        previewIframeRef: { current: null },
        showToast: vi.fn(),
        commitPositionPatchToHtml,
        readOnlyPreview: false,
      });
      return null;
    }

    act(() => root.render(<Probe />));
    await expect(commits!.handleDomPathOffsetCommit(selection, { x: 50, y: 60 })).rejects.toBe(
      failure,
    );
    await expect(
      commits!.handleDomBoxSizeCommit(selection, { width: 200, height: 160 }, { x: 30, y: 40 }),
    ).rejects.toBe(failure);
    await expect(commits!.handleDomRotationCommit(selection, { angle: 45 })).rejects.toBe(failure);
    await expect(commits!.handleDomManualEditsReset(selection)).rejects.toBe(failure);

    expect(readStudioPathOffset(element)).toEqual({ x: 10, y: 20 });
    expect(readStudioBoxSize(element)).toEqual({ width: 100, height: 80 });
    expect(readStudioRotation(element)).toEqual({ angle: 15 });
    act(() => root.unmount());
  });
});

describe("useDomGeometryCommits read-only preview", () => {
  const selectionOn = (element: HTMLElement) =>
    ({ id: element.id, selector: `#${element.id}`, element }) as unknown as DomEditSelection;

  it("refuses a manual offset commit: no write, no history entry", async () => {
    const element = document.createElement("div");
    element.id = "ro-offset";
    document.body.append(element);
    applyStudioPathOffset(element, { x: 1, y: 2 });
    const commitPositionPatchToHtml =
      vi.fn<UseDomGeometryCommitsParams["commitPositionPatchToHtml"]>();
    const { commits, unmount } = mountCommits(commitPositionPatchToHtml, true);
    await commits().handleDomPathOffsetCommit(selectionOn(element), { x: 99, y: 99 });
    expect(readStudioPathOffset(element)).toEqual({ x: 1, y: 2 });
    expect(commitPositionPatchToHtml).not.toHaveBeenCalled();
    unmount();
  });

  it("refuses a manual box-size commit: no write, no history entry", async () => {
    const element = document.createElement("div");
    element.id = "ro-size";
    document.body.append(element);
    applyStudioBoxSize(element, { width: 10, height: 20 });
    const commitPositionPatchToHtml =
      vi.fn<UseDomGeometryCommitsParams["commitPositionPatchToHtml"]>();
    const { commits, unmount } = mountCommits(commitPositionPatchToHtml, true);
    await commits().handleDomBoxSizeCommit(selectionOn(element), { width: 999, height: 999 });
    expect(readStudioBoxSize(element)).toEqual({ width: 10, height: 20 });
    expect(commitPositionPatchToHtml).not.toHaveBeenCalled();
    unmount();
  });

  it("refuses a manual rotation commit: no write, no history entry", async () => {
    const element = document.createElement("div");
    element.id = "ro-rotate";
    document.body.append(element);
    applyStudioRotation(element, { angle: 5 });
    const commitPositionPatchToHtml =
      vi.fn<UseDomGeometryCommitsParams["commitPositionPatchToHtml"]>();
    const { commits, unmount } = mountCommits(commitPositionPatchToHtml, true);
    await commits().handleDomRotationCommit(selectionOn(element), { angle: 350 });
    expect(readStudioRotation(element)).toEqual({ angle: 5 });
    expect(commitPositionPatchToHtml).not.toHaveBeenCalled();
    unmount();
  });

  it("still commits an offset with the flag off", async () => {
    const element = document.createElement("div");
    element.id = "rw-offset";
    document.body.append(element);
    const commitPositionPatchToHtml = vi
      .fn<UseDomGeometryCommitsParams["commitPositionPatchToHtml"]>()
      .mockResolvedValue(undefined);
    const { commits, unmount } = mountCommits(commitPositionPatchToHtml);
    await commits().handleDomPathOffsetCommit(selectionOn(element), { x: 5, y: 6 });
    expect(commitPositionPatchToHtml).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("useDomGeometryCommits element position offset", () => {
  it("persists left/top on a word a shared tween positions, and no translate offset", async () => {
    const element = Object.assign(document.createElement("span"), {
      _gsap: { renderTransform: () => {} },
    });
    Object.defineProperties(element, {
      offsetLeft: { get: () => 100 + (Number.parseFloat(element.style.left) || 0) },
      offsetTop: { get: () => 200 + (Number.parseFloat(element.style.top) || 0) },
    });
    document.body.append(element);
    const selection = { hfId: "w0", selector: ".w", element } as unknown as DomEditSelection;
    const commitPositionPatchToHtml = vi
      .fn<UseDomGeometryCommitsParams["commitPositionPatchToHtml"]>()
      .mockResolvedValue(undefined);
    const { commits, unmount } = mountCommits(commitPositionPatchToHtml);

    await commits().stageElementPositionOffset(selection, { x: 40, y: 20 }).save();

    const patches = commitPositionPatchToHtml.mock.calls[0]![1];
    expect(patches).toEqual([
      { type: "inline-style", property: "position", value: "relative" },
      { type: "inline-style", property: "left", value: "40px" },
      { type: "inline-style", property: "top", value: "20px" },
    ]);
    expect(element.style.getPropertyValue("translate")).toBe("");
    unmount();
  });
});

describe("useDomGeometryCommits resize of a cropped element", () => {
  it("saves the crop scaled per axis with the box in the resize's own commit", async () => {
    const element = withInlineLayoutBox(document.createElement("div"));
    element.id = "cropped";
    element.style.cssText = "width: 300px; height: 200px; clip-path: inset(8px 60px 16px 30px)";
    document.body.append(element);
    const selection = {
      id: "cropped",
      selector: "#cropped",
      element,
    } as unknown as DomEditSelection;
    const commitPositionPatchToHtml = vi
      .fn<UseDomGeometryCommitsParams["commitPositionPatchToHtml"]>()
      .mockResolvedValue(undefined);
    const { commits, unmount } = mountCommits(commitPositionPatchToHtml);
    const rect = { left: 0, top: 0, width: 300, height: 200, editScaleX: 1, editScaleY: 1 };
    const host = document.createElement("div");
    const crop = createRoot(host);
    act(() =>
      crop.render(
        <DomEditCropHandles selection={selection} overlayRect={rect} onStyleCommit={vi.fn()} />,
      ),
    );

    await commits().handleDomBoxSizeCommit(selection, { width: 450, height: 250 });

    const scaled = "inset(10px 90px 20px 45px)";
    expect(commitPositionPatchToHtml).toHaveBeenCalledTimes(1);
    expect(commitPositionPatchToHtml.mock.calls[0]![1]).toContainEqual({
      type: "inline-style",
      property: "clip-path",
      value: scaled,
    });
    act(() => crop.unmount());
    expect(element.style.getPropertyValue("clip-path")).toBe(scaled);
    unmount();
  });

  function mountCroppedSelection(id: string, authored: string) {
    const element = withInlineLayoutBox(document.createElement("div"));
    element.id = id;
    element.style.cssText = authored;
    document.body.append(element);
    const selection = { id, selector: `#${id}`, element } as unknown as DomEditSelection;
    const commitPositionPatchToHtml = vi
      .fn<UseDomGeometryCommitsParams["commitPositionPatchToHtml"]>()
      .mockResolvedValue(undefined);
    const mounted = mountCommits(commitPositionPatchToHtml);
    const onStyleCommit = vi.fn((property: string, value: string) => {
      element.style.setProperty(property, value);
    });
    const rect = { left: 0, top: 0, width: 300, height: 200, editScaleX: 1, editScaleY: 1 };
    const crop = createRoot(document.body.appendChild(document.createElement("div")));
    const draw = () =>
      act(() =>
        crop.render(
          <DomEditCropHandles
            selection={selection}
            overlayRect={rect}
            onStyleCommit={onStyleCommit}
          />,
        ),
      );
    draw();
    const dragRightEdge = (by: number) => {
      const handle = document.querySelector<HTMLButtonElement>('[aria-label="Crop right"]')!;
      const press = (type: string, clientX: number) =>
        act(() =>
          handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 3, clientX })),
        );
      press("pointerdown", 100);
      press("pointermove", 100 - by);
      press("pointerup", 100 - by);
    };
    const resize = () =>
      mounted.commits().handleDomBoxSizeCommit(selection, { width: 450, height: 300 });
    const done = () => {
      act(() => crop.unmount());
      mounted.unmount();
    };
    return { element, onStyleCommit, draw, dragRightEdge, resize, done };
  }

  it("after an undo while still selected, the next crop drag starts from the undone crop", async () => {
    const authored = "width: 300px; height: 200px; clip-path: inset(0px 60px 0px 0px)";
    const h = mountCroppedSelection("undone", authored);
    await h.resize();
    // Undo writes the file's style attribute back onto the same live element.
    h.element.setAttribute("style", authored);
    h.draw();
    h.dragRightEdge(20);

    expect(h.onStyleCommit).toHaveBeenCalledWith("clip-path", "inset(0px 80px 0px 0px)");
    h.done();
    expect(h.element.style.getPropertyValue("clip-path")).toBe("inset(0px 80px 0px 0px)");
  });

  it("a crop drag right after a resize, with no render between, starts from the scaled crop", async () => {
    const h = mountCroppedSelection(
      "resized",
      "width: 300px; height: 200px; clip-path: inset(0px 60px 0px 0px)",
    );
    await h.resize();
    h.dragRightEdge(20);

    expect(h.onStyleCommit).toHaveBeenCalledWith("clip-path", "inset(0px 110px 0px 0px)");
    h.done();
  });
});
