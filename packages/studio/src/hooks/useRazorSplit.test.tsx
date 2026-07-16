// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { useRazorSplit } from "./useRazorSplit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useRazorSplit mutation versions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("observes each out-of-band mutation version before the OCC writer runs", async () => {
    const original = '<div id="clip" data-start="0" data-duration="4">Clip</div>';
    const htmlSplit =
      '<div id="clip" data-start="0" data-duration="2">Clip</div><div id="clip-split" data-start="2" data-duration="2">Clip</div>';
    const final = `${htmlSplit}<script>window.__timelines = {}</script>`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/files/")) return jsonResponse({ content: original });
      if (url.includes("/file-mutations/split-element/")) {
        return jsonResponse({ ok: true, changed: true, content: htmlSplit, version: '"v-html"' });
      }
      if (url.includes("/gsap-mutations/")) {
        return jsonResponse({ ok: true, changed: true, after: final, version: '"v-gsap"' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const order: string[] = [];
    const observeProjectFileVersion = vi.fn((path: string, version: string | null) => {
      order.push(`observe:${path}:${version}`);
    });
    const writeProjectFile = vi.fn(async () => {
      order.push("write");
    });
    const recordEdit = vi.fn().mockResolvedValue(undefined);
    let split: ((element: TimelineElement, splitTime: number) => Promise<void>) | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      split = useRazorSplit({
        projectId: "p1",
        activeCompPath: "index.html",
        showToast: vi.fn(),
        writeProjectFile,
        observeProjectFileVersion,
        recordEdit,
        domEditSaveTimestampRef: { current: 0 },
        reloadPreview: vi.fn(),
      }).handleRazorSplit;
      return null;
    }

    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => {
      await split?.(
        {
          id: "clip",
          domId: "clip",
          hfId: "clip",
          tag: "div",
          start: 0,
          duration: 4,
          track: 0,
          timingSource: "authored",
        },
        2,
      );
    });

    expect(order).toEqual(['observe:index.html:"v-html"', 'observe:index.html:"v-gsap"', "write"]);
    expect(writeProjectFile).toHaveBeenCalledWith("index.html", final, original);
    expect(recordEdit).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });
});
