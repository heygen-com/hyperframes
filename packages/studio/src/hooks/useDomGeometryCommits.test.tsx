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
import { useDomGeometryCommits } from "./useDomGeometryCommits";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    const commitPositionPatchToHtml = vi.fn().mockRejectedValue(failure);
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

    expect(readStudioPathOffset(element)).toEqual({ x: 10, y: 20 });
    expect(readStudioBoxSize(element)).toEqual({ width: 100, height: 80 });
    expect(readStudioRotation(element)).toEqual({ angle: 15 });
    act(() => root.unmount());
  });
});
