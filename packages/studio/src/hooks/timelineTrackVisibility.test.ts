// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { toggleTimelineElementHidden, toggleTimelineTrackHidden } from "./timelineTrackVisibility";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  usePlayerStore.getState().reset();
});

function element(overrides: Partial<TimelineElement>): TimelineElement {
  return {
    id: "clip",
    tag: "div",
    start: 0,
    duration: 2,
    track: 0,
    ...overrides,
  };
}

function stubProjectFiles(files: Map<string, string>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const encodedPath = url.slice(url.lastIndexOf("/") + 1);
      const path = decodeURIComponent(encodedPath);
      const content = files.get(path);
      return new Response(JSON.stringify({ content }), {
        status: content === undefined ? 404 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

describe("toggleTimelineTrackHidden", () => {
  it("patches iframe DOM and persists all track elements as one edit-history entry", async () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    if (iframe.contentDocument) {
      iframe.contentDocument.body.innerHTML = `
        <div id="hero"></div>
        <div data-composition-id="scene" data-composition-file="scene.html">
          <div id="subtitle"></div>
        </div>
      `;
    }

    const files = new Map([
      [
        "index.html",
        `<div id="hero" data-start="0" data-duration="2"></div>
<div id="skip" data-start="0" data-duration="2"></div>`,
      ],
      ["scene.html", `<div id="subtitle" data-start="1" data-duration="2"></div>`],
    ]);
    stubProjectFiles(files);

    const writes = new Map<string, string>();
    const recordEdit = vi.fn();
    const timestampRef = { current: 0 };
    const pendingRef = { current: new Set<string>() };

    await toggleTimelineTrackHidden({
      projectId: "project-1",
      activeCompPath: "index.html",
      timelineElements: [
        element({ id: "hero", domId: "hero", track: 0 }),
        element({ id: "skip", domId: "skip", track: 1 }),
        element({ id: "subtitle", domId: "subtitle", track: 0, sourceFile: "scene.html" }),
      ],
      track: 0,
      hidden: true,
      previewIframe: iframe,
      writeProjectFile: async (path, content) => {
        writes.set(path, content);
      },
      recordEdit,
      domEditSaveTimestampRef: timestampRef,
      pendingTimelineEditPathRef: pendingRef,
    });

    expect(iframe.contentDocument?.getElementById("hero")?.hasAttribute("data-hidden")).toBe(true);
    expect(iframe.contentDocument?.getElementById("subtitle")?.hasAttribute("data-hidden")).toBe(
      true,
    );
    expect(writes.get("index.html")).toContain('id="hero" data-start="0" data-duration="2"');
    expect(writes.get("index.html")).toContain('data-hidden=""');
    expect(writes.get("index.html")).toContain('id="skip" data-start="0" data-duration="2"');
    expect(writes.get("scene.html")).toContain('data-hidden=""');
    expect(pendingRef.current).toEqual(new Set(["index.html", "scene.html"]));
    expect(timestampRef.current).toBeGreaterThan(0);
    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(recordEdit.mock.calls[0]?.[0]?.label).toBe("Hide track 0");
    expect(Object.keys(recordEdit.mock.calls[0]?.[0]?.files ?? {}).sort()).toEqual([
      "index.html",
      "scene.html",
    ]);
  });

  it("removes data-hidden from every element on the track", async () => {
    const files = new Map([
      [
        "index.html",
        `<div id="hero" data-start="0" data-duration="2" data-hidden=""></div>
<div id="caption" data-start="2" data-duration="2" data-hidden=""></div>`,
      ],
    ]);
    stubProjectFiles(files);

    const writes = new Map<string, string>();

    await toggleTimelineTrackHidden({
      projectId: "project-1",
      activeCompPath: "index.html",
      timelineElements: [
        element({ id: "hero", domId: "hero", track: 0, hidden: true }),
        element({ id: "caption", domId: "caption", track: 0, hidden: true }),
      ],
      track: 0,
      hidden: false,
      previewIframe: null,
      writeProjectFile: async (path, content) => {
        writes.set(path, content);
      },
      recordEdit: vi.fn(),
      domEditSaveTimestampRef: { current: 0 },
      pendingTimelineEditPathRef: { current: new Set() },
    });

    expect(writes.get("index.html")).not.toContain("data-hidden");
  });
});

describe("toggleTimelineElementHidden", () => {
  it("persists data-hidden for only the selected element and updates the player store", async () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const seek = vi.fn();
    const win = iframe.contentWindow;
    if (!win) throw new Error("Expected iframe contentWindow");
    const playerWindow: Window & { __player?: { seek?: (time: number) => void } } = win;
    playerWindow.__player = { seek };

    const files = new Map([
      [
        "index.html",
        `<div id="hero" data-start="0" data-duration="2"></div>
<div id="track-mate" data-start="1" data-duration="2"></div>`,
      ],
    ]);
    stubProjectFiles(files);

    const hero = element({ id: "hero", key: "index.html:#hero", domId: "hero", track: 0 });
    const trackMate = element({
      id: "track-mate",
      key: "index.html:#track-mate",
      domId: "track-mate",
      track: 0,
    });
    usePlayerStore.getState().setElements([hero, trackMate]);
    usePlayerStore.getState().setCurrentTime(1.25);

    const writes = new Map<string, string>();
    const recordEdit = vi.fn();

    const changedPaths = await toggleTimelineElementHidden({
      projectId: "project-1",
      activeCompPath: "index.html",
      timelineElements: [hero, trackMate],
      elementKey: "index.html:#hero",
      hidden: true,
      previewIframe: iframe,
      writeProjectFile: async (path, content) => {
        writes.set(path, content);
      },
      recordEdit,
      domEditSaveTimestampRef: { current: 0 },
      pendingTimelineEditPathRef: { current: new Set() },
    });

    expect(changedPaths).toEqual(["index.html"]);
    expect(writes.get("index.html")).toContain('id="hero" data-start="0" data-duration="2"');
    expect(writes.get("index.html")).toContain(
      'id="hero" data-start="0" data-duration="2" data-hidden=""',
    );
    expect(writes.get("index.html")).toContain(
      'id="track-mate" data-start="1" data-duration="2"></div>',
    );
    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(recordEdit.mock.calls[0]?.[0]?.label).toBe("Hide element");
    expect(seek).toHaveBeenCalledWith(1.25);
    expect(
      usePlayerStore.getState().elements.find((el) => el.key === "index.html:#hero")?.hidden,
    ).toBe(true);
    expect(
      usePlayerStore.getState().elements.find((el) => el.key === "index.html:#track-mate")?.hidden,
    ).toBeUndefined();
  });

  it("hides several elements in ONE atomic write when given an array of keys", async () => {
    const files = new Map([
      [
        "index.html",
        `<div id="hero" data-start="0" data-duration="2"></div>
<div id="caption" data-start="1" data-duration="2"></div>
<div id="badge" data-start="2" data-duration="2"></div>`,
      ],
    ]);
    stubProjectFiles(files);

    const hero = element({ id: "hero", key: "index.html:#hero", domId: "hero", track: 0 });
    const caption = element({
      id: "caption",
      key: "index.html:#caption",
      domId: "caption",
      track: 1,
    });
    const badge = element({ id: "badge", key: "index.html:#badge", domId: "badge", track: 2 });

    const writes: Array<{ path: string; content: string }> = [];
    const recordEdit = vi.fn();

    await toggleTimelineElementHidden({
      projectId: "project-1",
      activeCompPath: "index.html",
      timelineElements: [hero, caption, badge],
      elementKey: ["index.html:#hero", "index.html:#caption"],
      hidden: true,
      previewIframe: null,
      writeProjectFile: async (path, content) => {
        writes.push({ path, content });
      },
      recordEdit,
      domEditSaveTimestampRef: { current: 0 },
      pendingTimelineEditPathRef: { current: new Set() },
    });

    // One write carrying BOTH hides — per-element writes would clobber each
    // other (each starts from the original file content).
    expect(writes).toHaveLength(1);
    expect(writes[0]?.content).toContain(
      'id="hero" data-start="0" data-duration="2" data-hidden=""',
    );
    expect(writes[0]?.content).toContain(
      'id="caption" data-start="1" data-duration="2" data-hidden=""',
    );
    expect(writes[0]?.content).toContain('id="badge" data-start="2" data-duration="2"></div>');
    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(recordEdit.mock.calls[0]?.[0]?.label).toBe("Hide 2 elements");
  });
});
