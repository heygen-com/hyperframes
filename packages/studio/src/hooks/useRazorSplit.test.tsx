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

  it("observes the batch version without a redundant client forward write", async () => {
    const original = '<div id="clip" data-start="0" data-duration="4">Clip</div>';
    const htmlSplit =
      '<div id="clip" data-start="0" data-duration="2">Clip</div><div id="clip-split" data-start="2" data-duration="2">Clip</div>';
    const final = `${htmlSplit}<script>window.__timelines = {}</script>`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/files/")) return jsonResponse({ content: original, version: '"v0"' });
      if (url.includes("/file-mutations/split-batch")) {
        return jsonResponse({
          ok: true,
          outcome: "committed",
          files: [
            {
              path: "index.html",
              before: original,
              after: final,
              version: '"v-cut"',
              writeToken: "cut-1",
              splitCount: 1,
              skippedSelectors: [],
            },
          ],
        });
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
        },
        2,
      );
    });

    expect(order).toEqual(['observe:index.html:"v-cut"']);
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(recordEdit).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });
});

describe("useRazorSplit linked clips", () => {
  afterEach(() => vi.restoreAllMocks());

  it("splits every member of a linked pair in one cut", async () => {
    const { usePlayerStore } = await import("../player");
    const clip = (id: string, tag: string): TimelineElement => ({
      id,
      domId: id,
      tag,
      start: 0,
      duration: 4,
      track: tag === "audio" ? 1 : 0,
      link: "lk-1",
    });
    const video = clip("talk", "video");
    usePlayerStore.getState().setElements([video, clip("talk-audio", "audio")]);
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/files/")) return jsonResponse({ content: "", version: '"v0"' });
      bodies.push(String(init?.body ?? ""));
      return jsonResponse({ error: "stop" }, 409);
    });
    let split: ((element: TimelineElement, splitTime: number) => Promise<void>) | undefined;
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    function Harness() {
      split = useRazorSplit({
        projectId: "p1",
        activeCompPath: "index.html",
        showToast: vi.fn(),
        writeProjectFile: vi.fn(),
        recordEdit: vi.fn(),
        reloadPreview: vi.fn(),
      }).handleRazorSplit;
      return null;
    }
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => {
      await split?.(video, 2);
    });
    const targets = JSON.parse(bodies[0] ?? "{}").files[0].targets.map(
      (cut: { originalId: string }) => cut.originalId,
    );
    expect(targets).toEqual(["talk", "talk-audio"]);
    act(() => root.unmount());
  });
});

interface RecordedCut {
  originalId?: string;
  splitTime: number;
}

describe("useRazorSplit rapid consecutive cuts", () => {
  const wideClip: TimelineElement = {
    id: "clip",
    domId: "clip",
    tag: "div",
    start: 0,
    duration: 10,
    track: 0,
  };
  const leftHalf: TimelineElement = { ...wideClip, duration: 5 };
  const rightHalf: TimelineElement = {
    ...wideClip,
    id: "clip-split",
    domId: "clip-split",
    start: 5,
  };

  afterEach(async () => {
    vi.restoreAllMocks();
    const { usePlayerStore } = await import("../player");
    usePlayerStore.setState({ elements: [] });
  });

  it("queues a second cut until the refreshed elements land, then re-aims it", async () => {
    const { usePlayerStore } = await import("../player");
    usePlayerStore.getState().setElements([wideClip]);
    const requests: RecordedCut[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/files/")) return jsonResponse({ content: "", version: '"v0"' });
      if (url.includes("/file-mutations/split-batch")) {
        const body = JSON.parse(String(init?.body)) as {
          files: Array<{ targets: RecordedCut[] }>;
        };
        for (const file of body.files) for (const target of file.targets) requests.push(target);
        return jsonResponse({
          ok: true,
          outcome: "committed",
          files: [
            {
              path: "index.html",
              before: "<a></a>",
              after: "<b></b>",
              version: '"v1"',
              writeToken: "cut",
              splitCount: 1,
              skippedSelectors: [],
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const toasts: string[] = [];
    let split: ((element: TimelineElement, splitTime: number) => Promise<void>) | undefined;
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    function Harness() {
      split = useRazorSplit({
        projectId: "p1",
        activeCompPath: "index.html",
        showToast: (message) => toasts.push(message),
        writeProjectFile: vi.fn(),
        recordEdit: vi.fn().mockResolvedValue(undefined),
        reloadPreview: vi.fn(),
      }).handleRazorSplit;
      return null;
    }
    await act(async () => root.render(React.createElement(Harness)));

    // First cut commits and arms the refresh gate (the preview reload is async).
    await act(async () => {
      await split?.(wideClip, 5);
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ originalId: "clip", splitTime: 5 });

    // Second click inside the refresh window: queued, nothing hits the server.
    await act(async () => {
      await split?.(wideClip, 3);
    });
    expect(requests).toHaveLength(1);

    // The reloaded preview reports the split halves; the queued cut replays
    // against them and re-aims at the piece that owns t=3 (the left half).
    await act(async () => {
      usePlayerStore.getState().setElements([leftHalf, rightHalf]);
    });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({ originalId: "clip", splitTime: 3 });
    expect(toasts.some((toast) => toast.includes("3.00"))).toBe(true);

    act(() => root.unmount());
  });

  it("replays a queued cut immediately when the first cut fails", async () => {
    const { usePlayerStore } = await import("../player");
    usePlayerStore.getState().setElements([wideClip]);
    const requests: RecordedCut[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/files/")) return jsonResponse({ content: "", version: '"v0"' });
      if (url.includes("/file-mutations/split-batch")) {
        const body = JSON.parse(String(init?.body)) as {
          files: Array<{ targets: RecordedCut[] }>;
        };
        for (const file of body.files) for (const target of file.targets) requests.push(target);
        return jsonResponse(
          { error: "Cut target was not found or was outside its authored bounds in index.html" },
          400,
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    let split: ((element: TimelineElement, splitTime: number) => Promise<void>) | undefined;
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    function Harness() {
      split = useRazorSplit({
        projectId: "p1",
        activeCompPath: "index.html",
        showToast: vi.fn(),
        writeProjectFile: vi.fn(),
        recordEdit: vi.fn().mockResolvedValue(undefined),
        reloadPreview: vi.fn(),
      }).handleRazorSplit;
      return null;
    }
    await act(async () => root.render(React.createElement(Harness)));

    await act(async () => {
      await split?.(wideClip, 5);
    });
    expect(requests).toHaveLength(1);
    // The failed cut changed nothing, so nothing will refresh: the queued click
    // replays right away instead of waiting for a refresh that never comes.
    await act(async () => {
      await split?.(wideClip, 3);
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ splitTime: 3 });

    act(() => root.unmount());
  });
});
