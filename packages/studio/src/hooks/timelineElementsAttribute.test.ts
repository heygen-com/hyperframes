// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
import type { TimelineElement } from "../player";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { parseTimelineFromDOM } from "../player/lib/timelineDOM";

const saved = vi.hoisted(() => ({ inputs: [] as Array<Record<string, unknown>> }));
vi.mock("../utils/studioFileHistory", () => ({
  saveProjectFilesWithHistory: vi.fn(async (input: Record<string, unknown>) => {
    saved.inputs.push(input);
    return [];
  }),
}));

import { useSetElementsAttribute } from "./timelineElementsAttribute";

const clip = (id: string, sourceFile?: string): TimelineElement => ({
  id,
  domId: id,
  tag: "audio",
  start: 0,
  duration: 1,
  track: 0,
  sourceFile,
});

describe("useSetElementsAttribute", () => {
  it("writes every clip's attribute in one history entry, one builder per file", async () => {
    const showToast = vi.fn();
    let write: ReturnType<typeof useSetElementsAttribute> | null = null;
    function Probe() {
      write = useSetElementsAttribute({
        projectIdRef: { current: "p1" },
        activeCompPath: "index.html",
        showToast,
        writeProjectFile: vi.fn(async () => {}),
        recordEdit: vi.fn(async () => {}),
        previewIframeRef: { current: null },
        pendingTimelineEditPathRef: { current: new Set<string>() },
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    await write?.(
      [
        { element: clip("a"), value: "0.5" },
        { element: clip("b"), value: "2" },
        { element: clip("c", "scene.html"), value: "1.5" },
      ],
      "data-volume",
      "Audio Gain",
    );
    act(() => root.unmount());
    expect(showToast).not.toHaveBeenCalled();
    expect(saved.inputs).toHaveLength(1);
    const input = saved.inputs[0];
    expect(input?.["label"]).toBe("Audio Gain");
    const files = input?.["files"];
    if (typeof files !== "object" || files === null) throw new Error("no files");
    expect(Object.keys(files).sort()).toEqual(["index.html", "scene.html"]);
    const build = Reflect.get(files, "index.html");
    const html = '<audio id="a" data-volume="1"></audio><audio id="b"></audio>';
    const out = typeof build === "function" ? String(build(html)) : "";
    expect(out).toContain('id="a" data-volume="0.5"');
    expect(out).toMatch(/id="b"[^>]*data-volume="2"/);
  });

  it("saves clips whose file has no ids yet by the ids the preview served them with, and refuses a clip the file lacks", async () => {
    saved.inputs.length = 0;
    // Added outside Studio: no id, no class, and nothing has stamped the file since.
    const onDisk = `<div data-composition-id="main" data-start="0" data-duration="10"><audio src="a.mp3" data-start="0" data-duration="4" data-track-index="0"></audio><audio src="b.mp3" data-start="4" data-duration="4" data-track-index="1"></audio></div>`;
    const doc = document.implementation.createHTMLDocument("");
    doc.body.innerHTML = ensureHfIds(onDisk);
    const served = parseTimelineFromDOM(doc, 10);
    expect(served.map((element) => element.hfId).every(Boolean)).toBe(true);
    let write: ReturnType<typeof useSetElementsAttribute> | null = null;
    function Probe() {
      write = useSetElementsAttribute({
        projectIdRef: { current: "p1" },
        activeCompPath: "index.html",
        showToast: vi.fn(),
        writeProjectFile: vi.fn(async () => {}),
        recordEdit: vi.fn(async () => {}),
        previewIframeRef: { current: null },
        pendingTimelineEditPathRef: { current: new Set<string>() },
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    await write?.(
      served.map((element) => ({ element, value: "0.3" })),
      "data-volume",
      "Audio Gain",
    );
    await write?.(
      [{ element: { ...served[0]!, hfId: "hf-gone" }, value: "0.3" }],
      "data-volume",
      "Audio Gain",
    );
    act(() => root.unmount());
    const build = (n: number) => {
      const files = saved.inputs[n]?.["files"];
      const fn = typeof files === "object" && files !== null && Reflect.get(files, "index.html");
      if (typeof fn !== "function") throw new Error("no builder for index.html");
      return (html: string) => String(fn(html));
    };
    expect(build(0)(onDisk).match(/data-volume="0\.3"/g)).toHaveLength(2);
    expect(() => build(1)(onDisk)).toThrow("Unable to patch timeline element");
  });

  it("refuses while recording, like the single-clip write", async () => {
    saved.inputs.length = 0;
    const showToast = vi.fn();
    let write: ReturnType<typeof useSetElementsAttribute> | null = null;
    function Probe() {
      write = useSetElementsAttribute({
        projectIdRef: { current: "p1" },
        activeCompPath: "index.html",
        showToast,
        writeProjectFile: vi.fn(async () => {}),
        recordEdit: vi.fn(async () => {}),
        previewIframeRef: { current: null },
        pendingTimelineEditPathRef: { current: new Set<string>() },
        isRecordingRef: { current: true },
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    await write?.([{ element: clip("a"), value: "0.5" }], "data-volume", "Audio Gain");
    act(() => root.unmount());
    expect(saved.inputs).toHaveLength(0);
    expect(showToast).toHaveBeenCalledWith("Cannot edit timeline while recording", "error");
  });
});
