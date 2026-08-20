// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTimelineStackingReorder,
  buildTimelineMoveTimingPatch,
  deleteSelectedKeyframes,
  extendRootDurationIfNeeded,
  patchIframeDomTiming,
  persistElementAttribute,
  persistTimelineBatchEdit,
  type PersistTimelineBatchChange,
} from "./timelineEditingHelpers";
import type { TimelineElement } from "../player/store/playerStore";
import { usePlayerStore } from "../player/store/playerStore";
import type { CommitMutationOptions } from "./gsapScriptCommitTypes";
import { timelineKeyframeSelectionKey } from "../player/components/timelineKeyframeIdentity";

afterEach(() => {
  usePlayerStore.getState().reset();
});

function makeIframeWith(html: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("expected iframe document");
  doc.body.innerHTML = html;
  return iframe;
}

function el(input: Partial<TimelineElement> & { id: string; tag: string }): TimelineElement {
  return {
    label: input.id,
    start: 0,
    duration: 5,
    track: 0,
    zIndex: 0,
    hasExplicitZIndex: false,
    stackingContextId: null,
    ...input,
  };
}

describe("applyTimelineStackingReorder", () => {
  it("commits via the change's own locator even when the element is not in timelineElements", () => {
    // Sub-comp children live in the preview iframe but NOT in the top-level
    // timelineElements list — the intent must be self-contained.
    const iframe = makeIframeWith(`
      <div data-composition-id="scene" data-composition-file="scenes/scene.html">
        <div id="chip" style="z-index: 1"></div>
      </div>
    `);
    const commit = vi.fn<(entries: unknown[]) => void>();

    applyTimelineStackingReorder({
      element: el({ id: "chip", tag: "div" }),
      stackingReorder: {
        contextKey: "scene",
        placement: { type: "above", layerId: "layer:scene:x" },
        zIndexChanges: [
          {
            key: "scenes/scene.html#chip",
            zIndex: 5,
            domId: "chip",
            sourceFile: "scenes/scene.html",
          },
        ],
      },
      timelineElements: [], // element intentionally absent from the top-level list
      iframe,
      activeCompPath: "index.html",
      commit,
    });

    expect(commit).toHaveBeenCalledTimes(1);
    const entries = commit.mock.calls[0]![0] as Array<{
      zIndex: number;
      id?: string;
      sourceFile: string;
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.zIndex).toBe(5);
    expect(entries[0]!.id).toBe("chip");
    expect(entries[0]!.sourceFile).toBe("scenes/scene.html");
  });

  it("never commits when the dragged clip is audio", () => {
    const iframe = makeIframeWith(`<audio id="track"></audio>`);
    const commit = vi.fn<(entries: unknown[]) => void>();

    applyTimelineStackingReorder({
      element: el({ id: "track", tag: "audio" }),
      stackingReorder: {
        contextKey: "main",
        placement: { type: "above", layerId: "layer:main:x" },
        zIndexChanges: [{ key: "track", zIndex: 5, domId: "track" }],
      },
      timelineElements: [],
      iframe,
      activeCompPath: "index.html",
      commit,
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it("resolves selectorIndex within the change's source file", () => {
    const iframe = makeIframeWith(`
      <div data-composition-id="root">
        <div class="chip">root</div>
        <div data-composition-id="scene" data-composition-file="scenes/scene.html">
          <div class="chip">scene zero</div>
          <div class="chip" style="z-index: 1">scene one</div>
        </div>
      </div>
    `);
    const sceneOne = iframe.contentDocument?.querySelectorAll(".chip")[2];
    const commit = vi.fn<(entries: unknown[]) => void>();

    applyTimelineStackingReorder({
      element: el({ id: "scene-one", tag: "div" }),
      stackingReorder: {
        contextKey: "scene",
        placement: { type: "above", layerId: "layer:scene:x" },
        zIndexChanges: [
          {
            key: "scenes/scene.html#.chip:1",
            zIndex: 5,
            selector: ".chip",
            selectorIndex: 1,
            sourceFile: "scenes/scene.html",
          },
        ],
      },
      timelineElements: [],
      iframe,
      activeCompPath: "index.html",
      commit,
    });

    const entries = commit.mock.calls[0]![0] as Array<{ element: Element }>;
    expect(entries[0]!.element).toBe(sceneOne);
  });
});

describe("patchIframeDomTiming", () => {
  it("patches a top-level composition host in its parent source file", () => {
    const iframe = makeIframeWith(`
      <div data-composition-id="root">
        <div
          id="scene-host"
          data-composition-id="scene"
          data-composition-src="compositions/scene.html"
          data-start="2"
        ></div>
      </div>
    `);
    const host = iframe.contentDocument?.getElementById("scene-host");
    const target = el({
      id: "scene-host",
      tag: "div",
      kind: "composition",
      domId: "scene-host",
      sourceFile: "index.html",
      compositionSrc: "compositions/scene.html",
    });

    patchIframeDomTiming(iframe, target, [["data-start", "9"]], "index.html");

    expect(host?.getAttribute("data-start")).toBe("9");
  });

  it("resolves selectorIndex within the element's source file", () => {
    const iframe = makeIframeWith(`
      <div data-composition-id="root">
        <div class="clip" data-start="1">root</div>
        <div data-composition-id="scene" data-composition-file="scenes/scene.html">
          <div class="clip" data-start="2">scene zero</div>
          <div class="clip" data-start="3">scene one</div>
        </div>
      </div>
    `);
    const clips = iframe.contentDocument?.querySelectorAll<HTMLElement>(".clip");
    const target = el({
      id: "scene-one",
      tag: "div",
      selector: ".clip",
      selectorIndex: 1,
      sourceFile: "scenes/scene.html",
    });

    patchIframeDomTiming(iframe, target, [["data-start", "9"]], "index.html");

    expect([...clips!].map((clip) => clip.dataset.start)).toEqual(["1", "2", "9"]);
  });

  it("resolves duplicate domId within the element's source file", () => {
    const iframe = makeIframeWith(`
      <div data-composition-id="root">
        <div id="card" data-start="1">root</div>
        <div data-composition-id="scene" data-composition-file="scenes/scene.html">
          <div id="card" data-start="2">scene</div>
        </div>
      </div>
    `);
    const cards = iframe.contentDocument?.querySelectorAll<HTMLElement>("#card");
    const target = el({
      id: "scene-card",
      tag: "div",
      domId: "card",
      sourceFile: "scenes/scene.html",
    });

    patchIframeDomTiming(iframe, target, [["data-start", "9"]], "index.html");

    expect([...cards!].map((card) => card.dataset.start)).toEqual(["1", "9"]);
  });
});

describe("extendRootDurationIfNeeded", () => {
  it("extends the player duration only when the new end is larger", () => {
    usePlayerStore.getState().setDuration(4);

    expect(extendRootDurationIfNeeded(5)).toBe(true);
    expect(usePlayerStore.getState().duration).toBe(5);

    expect(extendRootDurationIfNeeded(5)).toBe(false);
    expect(extendRootDurationIfNeeded(3)).toBe(false);
    expect(usePlayerStore.getState().duration).toBe(5);
  });
});

describe("persistTimelineBatchEdit", () => {
  const SOURCE = `<div id="root"><video id="a" class="clip" data-start="1" data-track-index="0"></video><video id="b" class="clip" data-start="2" data-track-index="1"></video></div>`;

  function batchInput(changes: PersistTimelineBatchChange[], writes: Array<[string, string]>) {
    return {
      projectId: "p1",
      activeCompPath: "index.html",
      label: "Move timeline clips",
      changes,
      writeProjectFile: async (path: string, content: string) => {
        writes.push([path, content]);
      },
      recordEdit: async () => {},
      domEditSaveTimestampRef: { current: 0 },
      pendingTimelineEditPathRef: { current: new Set<string>() },
    };
  }

  function stubReadFileContent(content: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ content }),
      })),
    );
  }

  function moveMember(
    id: string,
    start: number,
    fromTrack: number,
    toTrack: number,
  ): PersistTimelineBatchChange {
    return {
      element: el({ id, tag: "video", domId: id, start, track: fromTrack }),
      buildPatches: (original, target) =>
        buildTimelineMoveTimingPatch(original, target, start, 5, toTrack),
    };
  }

  async function runBatch(changes: PersistTimelineBatchChange[]) {
    stubReadFileContent(SOURCE);
    const writes: Array<[string, string]> = [];
    await persistTimelineBatchEdit(batchInput(changes, writes));
    return writes;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips no-op members instead of aborting the batch (track-insert renumber)", async () => {
    // A track-insert renumber can include a member whose attributes already
    // hold the target values — its patch is string-identical. The batch must
    // skip it and still persist the members that DID change.
    const writes = await runBatch([
      // no-op: data-start already "1", track already 0
      moveMember("a", 1, 0, 0),
      // real change: track 1 -> 2
      moveMember("b", 2, 1, 2),
    ]);

    expect(writes).toHaveLength(1);
    expect(writes[0]![0]).toBe("index.html");
    expect(writes[0]![1]).toContain('id="b" class="clip" data-start="2" data-track-index="2"');
  });

  it("saves nothing when every member is a no-op", async () => {
    const writes = await runBatch([moveMember("a", 1, 0, 0)]);

    expect(writes).toHaveLength(0);
  });

  it("throws on a mistargeted member instead of silently dropping it", async () => {
    // A member whose target does not resolve in the source (stale id) patches
    // to the identical string too — but that is a targeting FAILURE, not an
    // already-at-target no-op, and must abort the batch like the single path.
    stubReadFileContent(SOURCE);
    const writes: Array<[string, string]> = [];

    await expect(
      persistTimelineBatchEdit(batchInput([moveMember("ghost", 3, 0, 2)], writes)),
    ).rejects.toThrow("Unable to patch timeline element ghost in index.html");
    expect(writes).toHaveLength(0);
  });
});

describe("deleteSelectedKeyframes", () => {
  it("coalesces all removals and reloads only after the last one", () => {
    usePlayerStore.setState({
      selectedElementId: "card",
      selectedKeyframes: new Set(["card:10", "card:50", "card:90"]),
    });
    const handleGsapRemoveKeyframe =
      vi.fn<(animId: string, pct: number, options?: Partial<CommitMutationOptions>) => void>();

    deleteSelectedKeyframes({
      selectedGsapAnimations: [{ id: "card-position", keyframes: {} }],
      handleGsapRemoveKeyframe,
    });

    expect(handleGsapRemoveKeyframe).toHaveBeenCalledTimes(3);
    const options = handleGsapRemoveKeyframe.mock.calls.map((call) => call[2]);
    expect(new Set(options.map((entry) => entry?.coalesceKey)).size).toBe(1);
    expect(options).toEqual([
      expect.objectContaining({ coalesceMs: Infinity, skipReload: true }),
      expect.objectContaining({ coalesceMs: Infinity, skipReload: true }),
      expect.objectContaining({ coalesceMs: Infinity, softReload: true }),
    ]);
    expect(options[0]).not.toHaveProperty("softReload");
    expect(options[1]).not.toHaveProperty("softReload");
    expect(options[2]).not.toHaveProperty("skipReload");
  });

  it("deletes two expanded lanes through their own animation and tween percentages", () => {
    usePlayerStore.setState({
      selectedElementId: "card",
      selectedKeyframes: new Set([
        timelineKeyframeSelectionKey("card", {
          percentage: 30,
          tweenPercentage: 20,
          propertyGroup: "position",
          animationId: "card-position",
        }),
        timelineKeyframeSelectionKey("card", {
          percentage: 70,
          tweenPercentage: 80,
          propertyGroup: "visual",
          animationId: "card-visual",
        }),
      ]),
    });
    const handleGsapRemoveKeyframe =
      vi.fn<(animId: string, pct: number, options?: Partial<CommitMutationOptions>) => void>();

    deleteSelectedKeyframes({
      selectedGsapAnimations: [
        { id: "card-position", keyframes: {} },
        { id: "card-visual", keyframes: {} },
      ],
      handleGsapRemoveKeyframe,
    });

    expect(handleGsapRemoveKeyframe).toHaveBeenCalledTimes(2);
    expect(
      handleGsapRemoveKeyframe.mock.calls.map(([animationId, percentage]) => [
        animationId,
        percentage,
      ]),
    ).toEqual([
      ["card-position", 20],
      ["card-visual", 80],
    ]);
    expect(handleGsapRemoveKeyframe.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ skipReload: true }),
    );
    expect(handleGsapRemoveKeyframe.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({ softReload: true }),
    );
  });

  it("drops keyframes that belong to other elements", () => {
    // A stale selection from a previously active element must not delete
    // anything on the element that is active now.
    usePlayerStore.setState({
      selectedElementId: "card",
      selectedKeyframes: new Set([
        timelineKeyframeSelectionKey("card", {
          percentage: 30,
          tweenPercentage: 20,
          propertyGroup: "position",
          animationId: "card-position",
        }),
        timelineKeyframeSelectionKey("other", {
          percentage: 70,
          tweenPercentage: 80,
          propertyGroup: "position",
          animationId: "card-position",
        }),
      ]),
    });
    const handleGsapRemoveKeyframe =
      vi.fn<(animId: string, pct: number, options?: Partial<CommitMutationOptions>) => void>();

    deleteSelectedKeyframes({
      selectedGsapAnimations: [{ id: "card-position", keyframes: {} }],
      handleGsapRemoveKeyframe,
    });

    expect(handleGsapRemoveKeyframe).toHaveBeenCalledTimes(1);
    expect(handleGsapRemoveKeyframe.mock.calls[0]?.[1]).toBe(20);
  });
});

describe("persistElementAttribute", () => {
  /**
   * The optimistic live patch used to run BEFORE the target was resolved, and
   * only the save was wrapped in the unwind. So an unresolvable target threw
   * with the preview holding a value that never reached disk — and the group
   * writer's catch mirrors the live DOM into the store, so the UI reported the
   * write as applied until a reload dropped it.
   */
  it("does not patch the live DOM when the target resolves to nothing", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ content: '<body><audio id="other"></audio></body>' })),
      );
    const patchLive = vi.fn();
    const writeProjectFile = vi.fn();

    await expect(
      persistElementAttribute({
        projectId: "p",
        targetPath: "index.html",
        patchTarget: { id: "missing" },
        attr: "data-volume",
        value: "0.4",
        label: "Set volume",
        writeProjectFile,
        recordEdit: vi.fn(),
        domEditSaveTimestampRef: { current: 0 },
        pendingTimelineEditPathRef: { current: new Set() },
        patchLive,
      }),
    ).rejects.toThrow("Unable to patch element in index.html");

    expect(patchLive).not.toHaveBeenCalled();
    expect(writeProjectFile).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("persistElementAttribute — unwind value", () => {
  /**
   * The unwind has to restore the value on DISK, not the one in the preview.
   *
   * Every live-write caller patches the DOM before committing (a fader drag is
   * `setLive` per frame; hovering a preset auditions the whole chain), so by
   * commit time the live DOM already holds the in-progress value. Reading it as
   * `previousValue` made the unwind a no-op, and the group writer's catch —
   * which deliberately re-mirrors the store off the live DOM — then mirrored the
   * never-saved value: the panel agreed with the preview, and a reload dropped it.
   */
  it("restores the file's value, not the audition already in the live DOM", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ content: `<body><audio id="bgm" data-volume="0.25"></audio></body>` }),
        ),
      );
    const patched: Array<string | null> = [];
    const writeProjectFile = vi.fn(() => Promise.reject(new Error("save failed")));

    await expect(
      persistElementAttribute({
        projectId: "p",
        targetPath: "index.html",
        patchTarget: { id: "bgm" },
        attr: "data-volume",
        value: "0.9",
        label: "Set volume",
        writeProjectFile,
        recordEdit: vi.fn(),
        domEditSaveTimestampRef: { current: 0 },
        pendingTimelineEditPathRef: { current: new Set() },
        // The live DOM is ALREADY at the new value when the commit runs — that
        // is what `setLive` does on every drag frame.
        patchLive: (v) => patched.push(v),
      }),
    ).rejects.toThrow("save failed");

    // First the optimistic write, then the unwind — back to what the FILE said.
    expect(patched).toEqual(["0.9", "0.25"]);
    fetchSpy.mockRestore();
  });
});
