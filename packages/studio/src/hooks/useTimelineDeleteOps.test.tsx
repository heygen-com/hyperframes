// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { applyRippleShifts, useTimelineDeleteOps } from "./useTimelineDeleteOps";
import { installReactActEnvironment, mountReactHarness } from "./domSelectionTestHarness";

installReactActEnvironment();

function el(id: string, start: number, duration: number, track = 0): TimelineElement {
  return { id, tag: "video", start, duration, track, domId: id };
}

describe("applyRippleShifts", () => {
  it("returns survivors unchanged when there are no changes", () => {
    const survivors = [el("a", 0, 2), el("c", 8, 1)];
    expect(applyRippleShifts(survivors, null)).toBe(survivors);
  });

  it("rewrites only the starts named by the changes", () => {
    const survivors = [el("a", 0, 2), el("c", 8, 1)];
    const result = applyRippleShifts(survivors, [{ element: survivors[1], start: 2 }]);
    expect(result).toEqual([el("a", 0, 2), el("c", 2, 1)]);
    expect(result[0]).toBe(survivors[0]);
  });
});

describe("useTimelineDeleteOps: ripple undo label", () => {
  const html = `<!DOCTYPE html><html data-composition-variables='[]'><body>
<div data-hf-id="hf-stage" data-hf-root data-duration="6">
<div data-hf-id="hf-a" data-start="0" data-duration="2"></div>
<div data-hf-id="hf-b" data-start="2" data-duration="2"></div>
<div data-hf-id="hf-c" data-start="4" data-duration="2"></div>
</div>
</body></html>`;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/file-mutations/remove-element/")) {
          return new Response(JSON.stringify({ changed: true, content: html }), { status: 200 });
        }
        return new Response(JSON.stringify({ content: html }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  // editHistory.ts's coalescing keeps the LAST recordEdit call's label, so the
  // folded ripple move must carry the delete's label, not its own.
  it("passes the delete's own label to the folded ripple move, not 'Move timeline clips'", async () => {
    const a = el("hf-a", 0, 2);
    const b = el("hf-b", 2, 2);
    const c = el("hf-c", 4, 2);
    const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);

    let hook: ReturnType<typeof useTimelineDeleteOps> | null = null;
    function Harness() {
      hook = useTimelineDeleteOps({
        projectIdRef: { current: "test-project" },
        activeCompPath: "index.html",
        timelineElements: [a, b, c],
        showToast: vi.fn(),
        writeProjectFile: vi.fn().mockResolvedValue(undefined),
        recordEdit: vi.fn().mockResolvedValue(undefined),
        reloadPreview: vi.fn(),
        previewIframeRef: { current: null },
        handleTimelineGroupMove,
      });
      return null;
    }

    mountReactHarness(<Harness />);
    await act(async () => {
      await hook!.handleTimelineElementDelete(b);
    });

    expect(handleTimelineGroupMove).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ label: "Delete timeline clip" }),
    );
  });
});
