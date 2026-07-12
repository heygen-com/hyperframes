import { describe, expect, it } from "vitest";
import {
  buildExpandedElements,
  resolveTimelineExpansionRawId,
} from "./useExpandedTimelineElements";
import { buildTimelineElementKey } from "../lib/timelineElementHelpers";
import type { TimelineElement } from "../store/playerStore";
import type { ClipManifestClip } from "../lib/playbackTypes";

const clip = (over: Partial<ClipManifestClip>): ClipManifestClip => ({
  id: "x",
  label: "x",
  start: 0,
  duration: 1,
  track: 0,
  kind: "element",
  tagName: "div",
  compositionId: null,
  parentCompositionId: null,
  compositionSrc: null,
  assetUrl: null,
  ...over,
});

const el = (over: Partial<TimelineElement>): TimelineElement => ({
  id: "x",
  start: 0,
  duration: 1,
  track: 0,
  tag: "div",
  ...over,
});

describe("buildExpandedElements", () => {
  it("rebases a 1-level child onto its sub-comp host (start + sourceFile)", () => {
    // host s3 at absolute 16 → stats-panel.html; children live in that file.
    const elements = [el({ id: "s3", start: 16, duration: 7, compositionSrc: "stats.html" })];
    const manifest = [
      clip({ id: "s3", start: 16, duration: 7, compositionSrc: "stats.html" }),
      clip({ id: "stat-1", start: 16.5, duration: 5 }),
      clip({ id: "stat-2", start: 16.9, duration: 5 }),
    ];
    const parentMap = new Map([
      ["stat-1", "s3"],
      ["stat-2", "s3"],
    ]);

    const out = buildExpandedElements(elements, manifest, parentMap, "s3", "s3");
    const child = out.find((e) => e.domId === "stat-1")!;
    expect(child.expandedParentStart).toBe(16);
    expect(child.sourceFile).toBe("stats.html");
  });

  // fallow-ignore-next-line code-duplication
  it("rebases a 2-level child onto its NESTED host, not the top-level scene", () => {
    // top host A@10 (a.html) embeds host B@12 (b.html); child C lives in b.html.
    // Edits must rebase onto B (12 / b.html), not A (10 / a.html).
    const elements = [el({ id: "A", start: 10, duration: 8, compositionSrc: "a.html" })];
    const manifest = [
      clip({ id: "A", start: 10, duration: 8, compositionSrc: "a.html" }),
      clip({ id: "B", start: 12, duration: 4, compositionSrc: "b.html" }),
      clip({ id: "C", start: 13, duration: 2 }),
      clip({ id: "C2", start: 14, duration: 1 }),
    ];
    const parentMap = new Map([
      ["B", "A"],
      ["C", "B"],
      ["C2", "B"],
    ]);

    // Expanding C's siblings: topLevel A, immediate parent B.
    const out = buildExpandedElements(elements, manifest, parentMap, "A", "B");
    const child = out.find((e) => e.domId === "C")!;
    expect(child.expandedParentStart).toBe(12); // B's start, not A's 10
    expect(child.sourceFile).toBe("b.html"); // B's file, not a.html
  });

  // fallow-ignore-next-line code-duplication
  it("rebases a 3-level child onto its deepest host, not intermediate or top", () => {
    // A@10 (a.html) → B@12 (b.html) → C@13 (c.html); leaf D lives in c.html.
    // Edits must rebase onto C (13 / c.html), not B (12 / b.html) or A (10 / a.html).
    const elements = [el({ id: "A", start: 10, duration: 8, compositionSrc: "a.html" })];
    const manifest = [
      clip({ id: "A", start: 10, duration: 8, compositionSrc: "a.html" }),
      clip({ id: "B", start: 12, duration: 5, compositionSrc: "b.html" }),
      clip({ id: "C", start: 13, duration: 3, compositionSrc: "c.html" }),
      clip({ id: "D", start: 13.5, duration: 1 }),
      clip({ id: "D2", start: 14, duration: 1 }),
    ];
    const parentMap = new Map([
      ["B", "A"],
      ["C", "B"],
      ["D", "C"],
      ["D2", "C"],
    ]);

    // Expanding D's siblings: topLevel A, immediate parent C.
    const out = buildExpandedElements(elements, manifest, parentMap, "A", "C");
    const child = out.find((e) => e.domId === "D")!;
    expect(child.expandedParentStart).toBe(13); // C's start, not B's 12 or A's 10
    expect(child.sourceFile).toBe("c.html"); // C's file, not b.html or a.html
  });

  // Regression: an expanded child must share one identity (`key`) with the flat
  // store element for the same DOM id. Before the fix the child key fell back to
  // the colon form (`index.html:eyebrow:N`) while the store/selection used the
  // hash form (`index.html#eyebrow`), so clicking an expanded child never
  // highlighted it (isSelected compares the two keys).
  it("keys expanded children in hash form, matching the flat store element", () => {
    // Single composition (no sub-comps): scene `s1` with same-file children.
    const elements = [el({ id: "s1", domId: "s1", start: 0, duration: 14 })];
    const manifest = [
      clip({ id: "s1", start: 0, duration: 14 }),
      clip({ id: "eyebrow", start: 0, duration: 14 }),
      clip({ id: "title", start: 0, duration: 14 }),
    ];
    const parentMap = new Map([
      ["eyebrow", "s1"],
      ["title", "s1"],
    ]);

    const out = buildExpandedElements(elements, manifest, parentMap, "s1", "s1");
    const child = out.find((e) => e.domId === "eyebrow")!;

    const expectedStoreKey = buildTimelineElementKey({
      id: "eyebrow",
      fallbackIndex: 0,
      domId: "eyebrow",
      selector: "#eyebrow",
      sourceFile: undefined,
    });
    expect(expectedStoreKey).toBe("index.html#eyebrow");
    expect(child.key).toBe("index.html#eyebrow");
    expect(child.key).toBe(expectedStoreKey);
  });

  // Sub-comp internals (group + pills) have no data-start, so they're not in the
  // manifest. They arrive as DOM children and must still expand under their host.
  it("expands DOM-only sub-comp children (no manifest clip) under the host", () => {
    const elements = [
      el({ id: "scene-host", start: 5, duration: 6, compositionSrc: "scene.html" }),
    ];
    const manifest = [
      clip({ id: "scene-host", start: 5, duration: 6, compositionSrc: "scene.html" }),
    ];
    // pill-3 selected → parent group-1 → host scene-host. None of group-1/pills
    // are in the manifest; they're DOM children with parent links.
    const parentMap = new Map([
      ["group-1", "scene-host"],
      ["pill-1", "group-1"],
      ["pill-2", "group-1"],
      ["pill-3", "group-1"],
    ]);
    const domClipChildren = [
      { id: "group-1", parentId: "scene-host", hostId: "scene-host", label: "Group 1" },
      { id: "pill-1", parentId: "group-1", hostId: "scene-host", label: "pill-1" },
      { id: "pill-2", parentId: "group-1", hostId: "scene-host", label: "pill-2" },
      { id: "pill-3", parentId: "group-1", hostId: "scene-host", label: "pill-3" },
    ];

    // Expanding pill-3's siblings: topLevel scene-host, immediate parent group-1.
    const out = buildExpandedElements(
      elements,
      manifest,
      parentMap,
      "scene-host",
      "group-1",
      domClipChildren,
    );
    const pills = out.filter((e) => e.domId?.startsWith("pill-"));
    expect(pills).toHaveLength(3);
    // Children span the host's bounds and rebase onto the host's file.
    expect(pills[0]!.start).toBe(5);
    expect(pills[0]!.duration).toBe(6);
    expect(pills[0]!.sourceFile).toBe("scene.html");
    // The host row is replaced by its children.
    expect(out.some((e) => e.domId === "scene-host")).toBe(false);
  });
});

describe("resolveTimelineExpansionRawId", () => {
  it("returns null when paused inside a childless top-level clip", () => {
    const manifest = [clip({ id: "title", start: 0, duration: 4 })];

    expect(
      resolveTimelineExpansionRawId({
        selectedElementId: null,
        isPlaying: false,
        currentTime: 2,
        manifest,
        parentMap: new Map(),
      }),
    ).toBeNull();
  });

  it("auto-expands an active composition with children when paused and nothing is selected", () => {
    const manifest = [
      clip({ id: "scene", start: 1, duration: 5 }),
      clip({ id: "headline", start: 1.5, duration: 2 }),
    ];
    const parentMap = new Map([["headline", "scene"]]);

    expect(
      resolveTimelineExpansionRawId({
        selectedElementId: null,
        isPlaying: false,
        currentTime: 2,
        manifest,
        parentMap,
      }),
    ).toBe("scene");
  });

  it("auto-expands the innermost active nested composition when paused", () => {
    const manifest = [
      clip({ id: "outer", start: 0, duration: 10 }),
      clip({ id: "inner", start: 2, duration: 5 }),
      clip({ id: "leaf", start: 3, duration: 1 }),
    ];
    const parentMap = new Map([
      ["inner", "outer"],
      ["leaf", "inner"],
    ]);

    expect(
      resolveTimelineExpansionRawId({
        selectedElementId: null,
        isPlaying: false,
        currentTime: 3.5,
        manifest,
        parentMap,
      }),
    ).toBe("inner");
  });

  it("does not auto-expand an active composition while playing", () => {
    const manifest = [
      clip({ id: "scene", start: 0, duration: 5 }),
      clip({ id: "headline", start: 1, duration: 2 }),
    ];
    const parentMap = new Map([["headline", "scene"]]);

    expect(
      resolveTimelineExpansionRawId({
        selectedElementId: null,
        isPlaying: true,
        currentTime: 2,
        manifest,
        parentMap,
      }),
    ).toBeNull();
  });

  it("keeps selected elements ahead of paused active composition auto-expansion", () => {
    const manifest = [
      clip({ id: "scene", start: 0, duration: 6 }),
      clip({ id: "headline", start: 1, duration: 2 }),
      clip({ id: "caption", start: 4, duration: 1 }),
    ];
    const parentMap = new Map([
      ["headline", "scene"],
      ["caption", "scene"],
    ]);

    expect(
      resolveTimelineExpansionRawId({
        selectedElementId: "caption",
        isPlaying: false,
        currentTime: 1.5,
        manifest,
        parentMap,
      }),
    ).toBe("caption");
  });
});
