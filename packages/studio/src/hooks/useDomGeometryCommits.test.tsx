// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { usePreviewReadOnlyStore } from "../components/editor/previewReadOnlyStore";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountCommits(
  commitPositionPatchToHtml: UseDomGeometryCommitsParams["commitPositionPatchToHtml"],
) {
  let commits: ReturnType<typeof useDomGeometryCommits> | null = null;
  function Probe() {
    commits = useDomGeometryCommits({
      previewIframeRef: { current: null },
      showToast: vi.fn(),
      commitPositionPatchToHtml,
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

  afterEach(() => usePreviewReadOnlyStore.setState({ readOnly: false }));

  it("refuses a manual offset commit: no write, no history entry", async () => {
    const element = document.createElement("div");
    element.id = "ro-offset";
    document.body.append(element);
    applyStudioPathOffset(element, { x: 1, y: 2 });
    usePreviewReadOnlyStore.setState({ readOnly: true });
    const commitPositionPatchToHtml =
      vi.fn<UseDomGeometryCommitsParams["commitPositionPatchToHtml"]>();
    const { commits, unmount } = mountCommits(commitPositionPatchToHtml);
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
    usePreviewReadOnlyStore.setState({ readOnly: true });
    const commitPositionPatchToHtml =
      vi.fn<UseDomGeometryCommitsParams["commitPositionPatchToHtml"]>();
    const { commits, unmount } = mountCommits(commitPositionPatchToHtml);
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
    usePreviewReadOnlyStore.setState({ readOnly: true });
    const commitPositionPatchToHtml =
      vi.fn<UseDomGeometryCommitsParams["commitPositionPatchToHtml"]>();
    const { commits, unmount } = mountCommits(commitPositionPatchToHtml);
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
