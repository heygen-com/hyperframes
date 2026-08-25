// @vitest-environment happy-dom

import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildExpandedElements,
  resolveTimelineExpansionRawId,
  useExpandedTimelineElements,
} from "./useExpandedTimelineElements";
import { buildTimelineElementKey } from "../lib/timelineElementHelpers";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { ClipManifestClip } from "../lib/playbackTypes";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function TimelineExpansionHarness({ onValue }: { onValue: (value: TimelineElement[]) => void }) {
  const value = useExpandedTimelineElements();
  useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return null;
}

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
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
    expect(child.expandedHostKey).toBe("s3");
    expect(child.sourceFile).toBe("stats.html");
  });

  it("keeps repeated same-source composition hosts as distinct move identities", () => {
    const elements = [
      el({
        id: "host-a",
        key: "index.html#host-a",
        start: 0,
        duration: 5,
        compositionSrc: "scene.html",
      }),
      el({
        id: "host-b",
        key: "index.html#host-b",
        start: 8,
        duration: 5,
        compositionSrc: "scene.html",
      }),
    ];
    const manifest = [
      clip({ id: "host-a", start: 0, duration: 5, compositionSrc: "scene.html" }),
      clip({ id: "child-a", start: 1, duration: 2 }),
      clip({ id: "host-b", start: 8, duration: 5, compositionSrc: "scene.html" }),
      clip({ id: "child-b", start: 9, duration: 2 }),
    ];
    const parentMap = new Map([
      ["child-a", "host-a"],
      ["child-b", "host-b"],
    ]);

    const childA = buildExpandedElements(elements, manifest, parentMap, "host-a", "host-a").find(
      (element) => element.domId === "child-a",
    );
    const childB = buildExpandedElements(elements, manifest, parentMap, "host-b", "host-b").find(
      (element) => element.domId === "child-b",
    );

    expect(childA?.sourceFile).toBe("scene.html");
    expect(childB?.sourceFile).toBe("scene.html");
    expect(childA?.expandedHostKey).toBe("index.html#host-a");
    expect(childB?.expandedHostKey).toBe("index.html#host-b");
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

  it("keeps the middle host's row when drilling two levels deep", () => {
    // A embeds B; C lives in B. Drilling into B must leave BOTH host rows
    // standing: sparing only the top-level one drops B's row, and its keyframe
    // lane goes with it because diamonds render per row.
    const elements = [
      el({ id: "A", domId: "A", start: 10, duration: 8, compositionSrc: "a.html" }),
      el({ id: "B", domId: "B", start: 12, duration: 4, track: 1, compositionSrc: "b.html" }),
    ];
    const manifest = [
      clip({ id: "A", start: 10, duration: 8, compositionSrc: "a.html" }),
      clip({ id: "B", start: 12, duration: 4, compositionSrc: "b.html" }),
      clip({ id: "C", start: 13, duration: 2 }),
    ];
    const parentMap = new Map([
      ["B", "A"],
      ["C", "B"],
    ]);

    const out = buildExpandedElements(elements, manifest, parentMap, "A", "B");
    const rows = out.map((e) => e.domId ?? e.id);
    expect(rows).toContain("B");
    // The child sits under its own host, not under the top-level row.
    expect(rows.indexOf("C")).toBeGreaterThan(rows.indexOf("B"));
  });

  it("still drills a host that exists only in the manifest, without a row for it", () => {
    // Same shape, but B has no store element, so there is no row to spare. The
    // children stay anchored to the top-level row rather than vanishing.
    const elements = [
      el({ id: "A", domId: "A", start: 10, duration: 8, compositionSrc: "a.html" }),
    ];
    const manifest = [
      clip({ id: "A", start: 10, duration: 8, compositionSrc: "a.html" }),
      clip({ id: "B", start: 12, duration: 4, compositionSrc: "b.html" }),
      clip({ id: "C", start: 13, duration: 2 }),
    ];
    const parentMap = new Map([
      ["B", "A"],
      ["C", "B"],
    ]);

    const out = buildExpandedElements(elements, manifest, parentMap, "A", "B");
    expect(out.map((e) => e.domId ?? e.id)).toEqual(["A", "C"]);
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

  // Regression: a child row is built from a manifest clip, which carries none of
  // the host element's attributes. Reading hidden off the manifest left every
  // expanded row reporting itself visible, so the eye wrote data-hidden a second
  // time instead of removing it and the element could never be shown again.
  it("inherits hidden and locked state from the flat store element", () => {
    const elements = [
      el({ id: "s1", domId: "s1", start: 0, duration: 14 }),
      el({
        id: "eyebrow",
        key: "index.html#eyebrow",
        domId: "eyebrow",
        start: 0,
        duration: 14,
        hidden: true,
        timelineLocked: true,
      }),
    ];
    const manifest = [
      clip({ id: "s1", start: 0, duration: 14 }),
      clip({ id: "eyebrow", start: 0, duration: 14 }),
    ];
    const parentMap = new Map([["eyebrow", "s1"]]);

    const out = buildExpandedElements(elements, manifest, parentMap, "s1", "s1");
    const child = out.find((e) => e.domId === "eyebrow")!;
    expect(child.hidden).toBe(true);
    expect(child.timelineLocked).toBe(true);
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
      {
        id: "group-1",
        parentId: "scene-host",
        hostId: "scene-host",
        label: "Group 1",
        stackingContextId: "css:0",
      },
      {
        id: "pill-1",
        parentId: "group-1",
        hostId: "scene-host",
        label: "pill-1",
        stackingContextId: "css:0.0",
      },
      {
        id: "pill-2",
        parentId: "group-1",
        hostId: "scene-host",
        label: "pill-2",
        stackingContextId: "css:0.1",
      },
      {
        id: "pill-3",
        parentId: "group-1",
        hostId: "scene-host",
        label: "pill-3",
        stackingContextId: "css:0.1",
      },
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
    expect(pills.map((pill) => pill.stackingContextId)).toEqual(["css:0.0", "css:0.1", "css:0.1"]);
    // The host row survives the expansion; its children are added under it.
    expect(out.some((e) => e.id === "scene-host")).toBe(true);
  });

  // fallow-ignore-next-line code-duplication
  it("keeps the host row and appends its children directly below it", () => {
    const elements = [
      el({
        id: "s3",
        domId: "s3",
        key: "index.html#s3",
        start: 16,
        duration: 7,
        compositionSrc: "stats.html",
      }),
      el({ id: "outro", start: 23, duration: 3, track: 1 }),
    ];
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

    const hostIndex = out.findIndex((e) => e.id === "s3");
    expect(hostIndex).toBeGreaterThanOrEqual(0);
    // Host row untouched (same key → same keyframe lane), children nested under it.
    expect(out[hostIndex]!.key).toBe("index.html#s3");
    expect(out[hostIndex]!.track).toBe(0);
    expect(out[hostIndex + 1]!.domId).toBe("stat-1");
    expect(out[hostIndex + 2]!.domId).toBe("stat-2");
    // Exactly one more row than the old substitution behaviour (host + 2 children + outro).
    expect(out).toHaveLength(4);
  });

  it("keeps the host row present at every playhead position (keyframe lane repro)", () => {
    // Live repro with no drag at all: seek 0 gave 3 diamonds, seek 7.68 gave 0,
    // seek 0.2 gave 3. Diamonds render per row from keyframeCache.get(elementKey),
    // so the whole lane went with the host row whenever the store-time drill-in
    // substituted it for its children.
    const elements = [
      el({ id: "scene", domId: "scene", key: "index.html#scene", start: 0, duration: 12 }),
    ];
    const manifest = [
      clip({ id: "scene", start: 0, duration: 12, compositionSrc: "scene.html" }),
      clip({ id: "headline", start: 0, duration: 12 }),
    ];
    const parentMap = new Map([["headline", "scene"]]);

    for (const currentTime of [0, 7.68, 0.2]) {
      const rawId = resolveTimelineExpansionRawId({
        selectedElementId: null,
        currentTime,
        manifest,
        parentMap,
      });
      const rows = rawId
        ? buildExpandedElements(elements, manifest, parentMap, rawId, rawId)
        : elements;
      expect(rows.map((row) => row.key)).toContain("index.html#scene");
    }
  });

  // Regression: DOM-only children were synthesized against the TOP-LEVEL element
  // instead of the sub-comp host they actually live in, so every child row read
  // the whole top-level window rather than its host's.
  it("spans DOM-only children over their nested host's window, not the top-level one", () => {
    const elements = [
      el({ id: "scene-host", start: 0, duration: 20, compositionSrc: "scene.html" }),
    ];
    const manifest = [
      clip({ id: "scene-host", start: 0, duration: 20, compositionSrc: "scene.html" }),
      clip({ id: "sub-host", start: 5, duration: 6, compositionSrc: "sub.html" }),
    ];
    const parentMap = new Map([
      ["sub-host", "scene-host"],
      ["pill-1", "sub-host"],
    ]);
    const domClipChildren = [
      {
        id: "pill-1",
        parentId: "sub-host",
        hostId: "sub-host",
        label: "pill-1",
        stackingContextId: "css:0.0",
      },
    ];

    const out = buildExpandedElements(
      elements,
      manifest,
      parentMap,
      "scene-host",
      "sub-host",
      domClipChildren,
    );
    const pill = out.find((e) => e.domId === "pill-1")!;
    expect(pill.start).toBe(5);
    expect(pill.duration).toBe(6);
    expect(pill.sourceFile).toBe("sub.html");
  });
});

describe("resolveTimelineExpansionRawId", () => {
  it("returns null inside a childless top-level clip", () => {
    const manifest = [clip({ id: "title", start: 0, duration: 4 })];

    expect(
      resolveTimelineExpansionRawId({
        selectedElementId: null,
        currentTime: 2,
        manifest,
        parentMap: new Map(),
      }),
    ).toBeNull();
  });

  it("auto-expands an active composition with children when nothing is selected", () => {
    const manifest = [
      clip({ id: "scene", start: 1, duration: 5 }),
      clip({ id: "headline", start: 1.5, duration: 2 }),
    ];
    const parentMap = new Map([["headline", "scene"]]);

    expect(
      resolveTimelineExpansionRawId({
        selectedElementId: null,
        currentTime: 2,
        manifest,
        parentMap,
      }),
    ).toBe("scene");
  });

  it("THE BUG: keeps a composition expanded with the playhead parked on its end", () => {
    // Clip windows are half-open, so at the very end of the timeline the
    // playhead was inside nothing and every expanded row collapsed.
    const manifest = [
      clip({ id: "scene", start: 0, duration: 12 }),
      clip({ id: "headline", start: 0, duration: 12 }),
    ];
    const parentMap = new Map([["headline", "scene"]]);

    expect(
      resolveTimelineExpansionRawId({
        selectedElementId: null,
        currentTime: 12,
        manifest,
        parentMap,
      }),
    ).toBe("scene");
  });

  it("prefers the starting clip over the ending one on a shared seam", () => {
    const manifest = [
      clip({ id: "first", start: 0, duration: 5 }),
      clip({ id: "first-child", start: 0, duration: 5 }),
      clip({ id: "second", start: 5, duration: 5 }),
      clip({ id: "second-child", start: 5, duration: 5 }),
    ];
    const parentMap = new Map([
      ["first-child", "first"],
      ["second-child", "second"],
    ]);

    expect(
      resolveTimelineExpansionRawId({
        selectedElementId: null,
        currentTime: 5,
        manifest,
        parentMap,
      }),
    ).toBe("second");
  });

  it("auto-expands the innermost active nested composition", () => {
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
        currentTime: 3.5,
        manifest,
        parentMap,
      }),
    ).toBe("inner");
  });

  it("resolves an active composition from the current store time", () => {
    const manifest = [
      clip({ id: "scene", start: 0, duration: 5 }),
      clip({ id: "headline", start: 1, duration: 2 }),
    ];
    const parentMap = new Map([["headline", "scene"]]);

    expect(
      resolveTimelineExpansionRawId({
        selectedElementId: null,
        currentTime: 2,
        manifest,
        parentMap,
      }),
    ).toBe("scene");
  });

  it("keeps inline children visible when the master timeline is playing", () => {
    const elements = [
      el({ id: "scene", domId: "scene", key: "index.html#scene", start: 0, duration: 5 }),
    ];
    const manifest = [
      clip({ id: "scene", start: 0, duration: 5, compositionSrc: "scene.html" }),
      clip({ id: "headline", start: 1, duration: 2 }),
    ];
    const parentMap = new Map([["headline", "scene"]]);
    let rows: TimelineElement[] | undefined;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      usePlayerStore.setState({
        elements,
        clipManifest: manifest,
        clipParentMap: parentMap,
        currentTime: 2,
        isPlaying: true,
      });
      root.render(
        React.createElement(TimelineExpansionHarness, {
          onValue: (value) => (rows = value),
        }),
      );
    });

    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(rows?.map((row) => row.domId ?? row.id)).toEqual(["scene", "headline"]);

    act(() => root.unmount());
  });

  it("keeps selected elements ahead of active composition auto-expansion", () => {
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
        currentTime: 1.5,
        manifest,
        parentMap,
      }),
    ).toBe("caption");
  });
});

describe("buildExpandedElements — collision-free synthetic rows (cross-file lane safety)", () => {
  it("expanded children NEVER share a display track with an unrelated top-level clip", () => {
    // The Deepwork regression: host on track 0 with two children used to put
    // child #2 on integer track 1 — the same lane as index.html#foreign. Lane
    // grouping merges purely by track number, so a gap-close on that "one"
    // lane batch-persisted a foreign file's clip.
    const elements = [
      el({ id: "host", start: 0, duration: 20, track: 0, compositionSrc: "scene.html" }),
      el({ id: "foreign", start: 20, duration: 5, track: 1 }),
    ];
    const manifest = [
      clip({ id: "host", start: 0, duration: 20, compositionSrc: "scene.html" }),
      clip({ id: "c1", start: 0, duration: 5 }),
      clip({ id: "c2", start: 10, duration: 5 }),
    ];
    const parentMap = new Map([
      ["c1", "host"],
      ["c2", "host"],
    ]);

    const out = buildExpandedElements(elements, manifest, parentMap, "host", "host");
    const foreign = out.find((e) => e.id === "foreign")!;
    const children = out.filter((e) => e.domId === "c1" || e.domId === "c2");
    expect(children).toHaveLength(2);
    for (const child of children) {
      // No lane sharing with the foreign clip…
      expect(child.track).not.toBe(foreign.track);
      // …and structurally impossible to collide with ANY normalized (integer)
      // lane: synthetic rows are strict fractions under the host's lane.
      expect(Number.isInteger(child.track)).toBe(false);
      expect(child.track).toBeGreaterThan(0);
      expect(child.track).toBeLessThan(1);
    }
    // Distinct ordered rows per child.
    expect(children[0].track).not.toBe(children[1].track);
  });

  /**
   * A sub-composition that declares BOTH a group and its members keeps those
   * members out of the flat store entirely — the store holds only the host.
   * So "inherit membership from the flat twin" had nothing to inherit from,
   * and the group produced no timeline row at all, for exactly the case group
   * support was extended to cover. Verified against a real studio session
   * before this test was written: the flat store held three elements (the
   * panel, the sub-comp host and an ungrouped bed) and neither voice.
   */
  it("takes group membership from the DOM child when there is no flat store twin", () => {
    const elements = [
      el({ id: "voices-host", start: 0, duration: 12, compositionSrc: "voices.html" }),
    ];
    const manifest = [
      clip({ id: "voices-host", start: 0, duration: 12, compositionSrc: "voices.html" }),
    ];
    const parentMap = new Map([
      ["voice-1", "voices-host"],
      ["voice-2", "voices-host"],
    ]);
    const domClipChildren = [
      {
        id: "voice-1",
        parentId: "voices-host",
        hostId: "voices-host",
        label: "voice-1",
        stackingContextId: "css:0",
        audioGroup: "voiceover",
        audioGroupLabel: "Voiceover",
        audioGroupVolume: 0.8,
        audioGroupHidden: false,
      },
      {
        id: "voice-2",
        parentId: "voices-host",
        hostId: "voices-host",
        label: "voice-2",
        stackingContextId: "css:0",
        audioGroup: "voiceover",
        audioGroupLabel: "Voiceover",
        audioGroupVolume: 0.8,
        audioGroupHidden: false,
      },
    ];

    const out = buildExpandedElements(
      elements,
      manifest,
      parentMap,
      "voices-host",
      "voices-host",
      domClipChildren,
    );

    const voices = out.filter((e) => e.domId?.startsWith("voice-"));
    expect(voices).toHaveLength(2);
    for (const voice of voices) {
      expect(voice.audioGroup).toBe("voiceover");
      expect(voice.audioGroupLabel).toBe("Voiceover");
      expect(voice.audioGroupVolume).toBeCloseTo(0.8, 6);
    }
  });
});

describe("sub-comp child rows never collide with a group anchor", () => {
  /**
   * A group row anchors at exactly `firstMemberTrack - 0.5`. The old child
   * scheme `k / (n + 2)` hit 0.5 dead on for a host with TWO children (2/4),
   * producing a duplicate row key and a duplicated group header.
   */
  it("keeps every child strictly below the host's half-lane", () => {
    for (const childCount of [1, 2, 3, 4, 7]) {
      const fractions = Array.from(
        { length: childCount },
        (_unused, i) => (0.5 * (i + 1)) / (childCount + 1),
      );
      expect(fractions.every((f) => f > 0 && f < 0.5)).toBe(true);
      // Still distinct and ordered, which is what makes them usable as rows.
      expect(new Set(fractions).size).toBe(childCount);
      expect([...fractions].sort((a, b) => a - b)).toEqual(fractions);
    }
  });
});
