// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import reference from "./__fixtures__/motion-blur-ae-reference.json";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const snippetHtml = readRepoFile("registry/components/motion-blur/motion-blur.html");

/** First line of the snippet's IIFE body, which runs to the `};` closing it at the same indent. */
const BODY_FIRST_LINE = "if (!window._hfMbUid) window._hfMbUid = 0;";
const SNIPPET_INDENT = " ".repeat(4);
const INLINED_INDENT = " ".repeat(10);

/**
 * The snippet's IIFE body, leading whitespace dropped so the installable snippet and its inlined
 * copies compare regardless of how deeply each one nests it.
 */
function snippetBody(source: string, indent: string): string {
  const start = source.indexOf(indent + BODY_FIRST_LINE);
  const endMarker = `\n${indent}};`;
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`could not locate the snippet body at indent ${indent.length}`);
  }
  return source
    .slice(start, end + endMarker.length)
    .split("\n")
    .map((line) => line.trimStart())
    .join("\n");
}

const FPS = 30;
/** Timeline time of the frame under test, and a duration long enough that no seek is clamped. */
const FRAME_TIME_S = 5;
const DURATION_S = 10;
const WORD_WIDTH = 1046;
const WORD_HEIGHT = 193;

/** The slice of GSAP's timeline API the snippet drives; `time()` reads, `time(value)` seeks. */
interface Timeline {
  time(value?: number, suppressEvents?: boolean): number | Timeline;
  duration(): number;
  to(target: unknown, vars: { onUpdate?: () => void }): Timeline;
}

/**
 * The reference's own trajectory around the measured frame: a parabola through the core centres of
 * frames 4, 5 and 6, with frame 5 at t = 0. Offsets are relative to the frame-time position, so the
 * shutter window's ends must land on exactly the trailing and leading displacements the fixture
 * records — which is the whole claim being pinned.
 */
function offsetAtFrames(df: number): number {
  const back = -reference.trailingDisplacementPx;
  const fwd = reference.leadingDisplacementPx;
  return ((fwd + back) / 2) * df * df + ((fwd - back) / 2) * df;
}

function installSnippet(): void {
  const body = snippetHtml.slice(
    snippetHtml.indexOf("<script>") + "<script>".length,
    snippetHtml.indexOf("</script>"),
  );
  new Function(body)();
}

function makeTimeline(): { tl: Timeline; currentTime: () => number; fire: () => void } {
  let now = FRAME_TIME_S;
  let onUpdate: (() => void) | undefined;
  const tl: Timeline = {
    time(value?: number) {
      if (value === undefined) return now;
      now = value;
      return tl;
    },
    duration: () => DURATION_S,
    to(_target, vars) {
      onUpdate = vars.onUpdate;
      return tl;
    },
  };
  return { tl, currentTime: () => now, fire: () => onUpdate?.() };
}

function installGsap(currentTime: () => number, trajectory: (df: number) => number): void {
  (globalThis as unknown as { gsap: unknown }).gsap = {
    getProperty(_el: Element, prop: string) {
      if (prop === "x") return `${trajectory((currentTime() - FRAME_TIME_S) * FPS)}px`;
      if (prop === "scaleX" || prop === "scaleY") return 1;
      return 0;
    },
  };
}

async function attach(
  options: Record<string, unknown>,
  trajectory: (df: number) => number = offsetAtFrames,
): Promise<Element> {
  const el = document.createElement("div");
  el.id = "word";
  Object.defineProperty(el, "offsetWidth", { value: WORD_WIDTH });
  Object.defineProperty(el, "offsetHeight", { value: WORD_HEIGHT });
  document.body.appendChild(el);

  const { tl, currentTime, fire } = makeTimeline();
  installGsap(currentTime, trajectory);
  installSnippet();
  (
    window as unknown as { attachMotionBlur: (s: string, t: Timeline, o: unknown) => void }
  ).attachMotionBlur("#word", tl, options);

  fire();
  await Promise.resolve();
  const filter = document.querySelector("filter");
  if (!filter) throw new Error("motion-blur filter was not created");
  return filter;
}

/** Horizontal offset of every duplicate, in window order. */
function copyOffsets(filter: Element): number[] {
  return [...filter.querySelectorAll("feOffset")].map((node) => Number(node.getAttribute("dx")));
}

/** The duplicates sitting at the two ends of the shutter window. */
function windowEdges(offsets: number[]): { trailing: number; leading: number } {
  const [trailing] = offsets;
  const leading = offsets.at(-1);
  if (trailing === undefined || leading === undefined) {
    throw new Error("the filter carries no duplicates");
  }
  return { trailing, leading };
}

/** Gap between each pair of neighbouring duplicates. */
function copyPitches(offsets: number[]): number[] {
  const pitches: number[] = [];
  offsets.forEach((offset, index) => {
    const previous = offsets[index - 1];
    if (previous !== undefined) pitches.push(offset - previous);
  });
  return pitches;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("motion-blur snippet copies", () => {
  // The demo and the example composition have to inline the snippet — a catalog demo is a single
  // self-contained file and cannot import one. That makes three copies of the same shutter model, so
  // the copies are asserted equal here rather than left to drift silently.
  it.each([
    "registry/components/motion-blur/demo.html",
    "registry/examples/motion-blur/index.html",
  ])("%s inlines the installable snippet verbatim", (relativePath) => {
    expect(snippetBody(readRepoFile(relativePath), INLINED_INDENT)).toBe(
      snippetBody(snippetHtml, SNIPPET_INDENT),
    );
  });
});

describe("motion-blur shutter matches the After Effects reference", () => {
  it("opens the shutter over the frame before and the frame after, at the measured sub-interval count", async () => {
    const offsets = copyOffsets(await attach({ fps: FPS }));
    const { trailing, leading } = windowEdges(offsets);

    expect(offsets).toHaveLength(reference.subIntervalsPerWindow + 1);
    expect(trailing).toBeCloseTo(-reference.trailingDisplacementPx, 1);
    expect(leading).toBeCloseTo(reference.leadingDisplacementPx, 1);
  });

  it("spaces the duplicates at the measured staircase pitch", async () => {
    // The reference's staircase is even (15, 16, 16, 15, 16, 16, 16 px across a 125.8 px frame
    // displacement), so a constant-velocity trajectory has to come out evenly spaced at 1/8 frame.
    const speed = reference.trailingDisplacementPx;
    const offsets = copyOffsets(await attach({ fps: FPS }, (df) => speed * df));
    const expected = speed / (reference.subIntervalsPerWindow / 2);

    for (const pitch of copyPitches(offsets)) expect(pitch).toBeCloseTo(expected, 3);
  });

  it("gives every duplicate the measured 1/16 opacity and none full opacity", async () => {
    const filter = await attach({ fps: FPS });
    const weights = [...filter.querySelectorAll("feComposite[operator='arithmetic']")].map((node) =>
      Number(node.getAttribute("k3")),
    );

    expect(weights).toHaveLength(reference.subIntervalsPerWindow);
    for (const weight of weights) expect(weight).toBeCloseTo(reference.copyOpacity, 6);
    // Flat, not tapered: the reference's plateau increments are all the same height.
    expect(new Set(weights).size).toBe(1);
  });

  it("accumulates every duplicate exactly once, in one unbroken chain", async () => {
    const filter = await attach({ fps: FPS });
    const adds = [...filter.querySelectorAll("feComposite[operator='arithmetic']")];
    const weight = 1 / reference.subIntervalsPerWindow;

    // The first composite is the only one that has to scale BOTH inputs, because it is the
    // only one whose `in` is a raw duplicate rather than the running sum. Getting its k2
    // wrong lets one duplicate through at full weight — the exact thing the reference rules out.
    expect(adds[0]?.getAttribute("in")).toBe("s0");
    expect(Number(adds[0]?.getAttribute("k2"))).toBeCloseTo(weight, 6);
    for (const add of adds.slice(1)) expect(Number(add.getAttribute("k2"))).toBe(1);

    // Each composite must fold in the next duplicate and feed the one after it, so every
    // duplicate reaches the output and none is added twice.
    adds.forEach((add, index) => {
      expect(add.getAttribute("in")).toBe(index === 0 ? "s0" : `a${index}`);
      expect(add.getAttribute("in2")).toBe(`s${index + 1}`);
      expect(add.getAttribute("result")).toBe(`a${index + 1}`);
    });
  });

  it("composites the sharp frame-time instance over the full accumulated smear", async () => {
    const filter = await attach({ fps: FPS });
    const last = filter.lastElementChild;

    expect(last?.tagName).toBe("feComposite");
    expect(last?.getAttribute("operator")).toBe("over");
    expect(last?.getAttribute("in")).toBe("SourceGraphic");
    // in2 must be the END of the accumulation chain, not some intermediate or single copy.
    expect(last?.getAttribute("in2")).toBe(`a${reference.subIntervalsPerWindow}`);
    expect(last?.getAttribute("result")).toBeNull();
  });

  it("keeps the sharp instance inside the filter region when the window is entirely one-sided", async () => {
    // shutterPhase 0 opens the shutter at the frame time, so every duplicate is ahead of the
    // element and no duplicate sits at offset 0 — but the sharp instance still does. A region
    // derived from the duplicates alone starts inside the element's own box and clips it.
    const filter = await attach({ fps: FPS, shutterPhase: 360 });
    const offsets = copyOffsets(filter);

    expect(Math.min(...offsets)).toBeGreaterThan(0);
    expect(Number.parseFloat(filter.getAttribute("x") ?? "")).toBeLessThanOrEqual(0);
    const right =
      Number.parseFloat(filter.getAttribute("x") ?? "") +
      Number.parseFloat(filter.getAttribute("width") ?? "");
    expect(right).toBeGreaterThanOrEqual((Math.max(...offsets) / WORD_WIDTH) * 100 + 100);
  });
});
