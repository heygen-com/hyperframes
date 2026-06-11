import { describe, expect, it } from "vitest";
import { buildExpandedElements } from "./useExpandedTimelineElements";
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

const el = (over: Partial<TimelineElement>): TimelineElement =>
  ({ id: "x", start: 0, duration: 1, track: 0, tag: "div", ...over }) as TimelineElement;

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
});
