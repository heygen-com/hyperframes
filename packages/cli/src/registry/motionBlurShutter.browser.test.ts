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

/** The snippet's IIFE body verbatim, located by the indent of its own first line, so a copy
 *  nested in a component template is found as readily as one in a demo plate. */
function snippetSource(source: string): string {
  const escaped = BODY_FIRST_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^([ ]*)${escaped}$`, "m").exec(source);
  const indent = match?.[1];
  if (match === null || indent === undefined) {
    throw new Error("could not locate the snippet body");
  }
  const endMarker = `\n${indent}};`;
  const end = source.indexOf(endMarker, match.index);
  if (end < 0) throw new Error("could not locate the end of the snippet body");
  return source.slice(match.index, end + endMarker.length);
}

/** Runs of code lines joined, because oxfmt wraps a statement differently at each nesting depth.
 *  Comment lines stay on their own line, so prose drift is still caught. */
function joinWrappedLines(body: string): string {
  const lines: string[] = [];
  for (const line of body.split("\n")) {
    const text = line.trim();
    if (text === "") continue;
    const previous = lines.at(-1);
    const separate = previous === undefined || text.startsWith("//") || previous.startsWith("//");
    if (separate) lines.push(text);
    else lines[lines.length - 1] = `${previous} ${text}`;
  }
  return lines.join("\n");
}

function snippetBody(source: string): string {
  return joinWrappedLines(snippetSource(source));
}

const FPS = 30;
/** Timeline time of the frame under test, and a duration long enough that no seek is clamped. */
const FRAME_TIME_S = 5;
const DURATION_S = 10;
const WORD_WIDTH = 1046;
const WORD_HEIGHT = 193;
const PERSPECTIVE = "2000px";
const COPIES = reference.subIntervalsPerWindow + 1;

/** The slice of GSAP's timeline API the snippet drives; `time()` reads, `time(value)` seeks. */
interface Timeline {
  time(value?: number, suppressEvents?: boolean): number | Timeline;
  duration(): number;
  to(target: unknown, vars: { onUpdate?: () => void }): Timeline;
}

/** A resolved transform at one sample time, as `getComputedStyle` would report it. */
type Trajectory = (framesFromNow: number) => string;

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

const translating: Trajectory = (df) => `matrix(1, 0, 0, 1, ${offsetAtFrames(df)}, 0)`;

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

/**
 * happy-dom resolves no transforms of its own, so the element's computed style is the trajectory.
 * The stub also answers the declaration enumeration the style replay uses, and the perspective.
 */
function installComputedStyle(
  word: Element,
  currentTime: () => number,
  trajectory: Trajectory,
  opacity: () => string,
  perspective: () => string,
): void {
  globalThis.getComputedStyle = ((element: Element) =>
    ({
      length: 0,
      getPropertyValue: () => "",
      transform: element === word ? trajectory((currentTime() - FRAME_TIME_S) * FPS) : "none",
      transformOrigin: "50% 50%",
      opacity: element === word ? opacity() : "1",
      perspective: element === word ? "none" : perspective(),
    }) as unknown as CSSStyleDeclaration) as typeof globalThis.getComputedStyle;
}

/** Captures the observers the snippet installs so a test can fire a resize itself. */
function installResizeObserver(): { resize: () => void } {
  const callbacks: Array<() => void> = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(callback: () => void) {
      callbacks.push(callback);
    }
    observe(): void {}
    disconnect(): void {}
  };
  return {
    resize: () => {
      for (const callback of callbacks) callback();
    },
  };
}

interface Attached {
  group: HTMLElement;
  word: HTMLElement;
  copies: HTMLElement[];
  fire: () => void;
  reattach: () => void;
}

async function attach(
  options: Record<string, unknown> = {},
  trajectory: Trajectory = translating,
  opacity: () => string = () => "1",
  perspective: () => string = () => PERSPECTIVE,
): Promise<Attached> {
  const stage = document.createElement("div");
  document.body.appendChild(stage);
  const word = document.createElement("div");
  word.id = "word";
  Object.defineProperty(word, "offsetWidth", { value: WORD_WIDTH });
  Object.defineProperty(word, "offsetHeight", { value: WORD_HEIGHT });
  Object.defineProperty(word, "offsetLeft", { value: 437 });
  Object.defineProperty(word, "offsetTop", { value: 442 });
  stage.appendChild(word);

  const { tl, currentTime, fire } = makeTimeline();
  installComputedStyle(word, currentTime, trajectory, opacity, perspective);
  installSnippet();
  const attachBlur = (
    window as unknown as { attachMotionBlur: (s: string, t: Timeline, o: unknown) => void }
  ).attachMotionBlur;
  const reattach = () => attachBlur("#word", tl, { fps: FPS, ...options });
  reattach();

  fire();
  await Promise.resolve();
  const group = document.querySelector<HTMLElement>("[data-hf-motion-blur]");
  if (!group) throw new Error("motion-blur group was not created");
  return { group, word, copies: [...group.children] as HTMLElement[], fire, reattach };
}

/** Horizontal translation of every duplicate, in window order. */
function copyOffsets(copies: HTMLElement[]): number[] {
  return copies.map((copy) => {
    const numbers = copy.style.transform.slice(copy.style.transform.lastIndexOf("(") + 1, -1);
    const parts = numbers.split(",").map((value) => Number.parseFloat(value));
    return parts[4] ?? Number.NaN;
  });
}

/** The duplicates sitting at the two ends of the shutter window. */
function windowEdges(offsets: number[]): { trailing: number; leading: number } {
  const [trailing] = offsets;
  const leading = offsets.at(-1);
  if (trailing === undefined || leading === undefined) {
    throw new Error("the group carries no duplicates");
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

const originalGetComputedStyle = globalThis.getComputedStyle;

afterEach(() => {
  document.body.innerHTML = "";
  globalThis.getComputedStyle = originalGetComputedStyle;
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
});

describe("motion-blur snippet copies", () => {
  // The demos and the example composition have to inline the snippet — a catalog plate is a single
  // self-contained file and cannot import one. That makes four copies of the same shutter model, so
  // the copies are asserted equal here rather than left to drift silently.
  it.each([
    "registry/components/motion-blur/demo.html",
    "registry/components/shutter-slam/shutter-slam.html",
    "registry/components/shutter-slam/demo.html",
    "registry/examples/motion-blur/index.html",
  ])("%s inlines the installable snippet verbatim", (relativePath) => {
    expect(snippetBody(readRepoFile(relativePath))).toBe(snippetBody(snippetHtml));
  });
});

describe("motion-blur shutter matches the After Effects reference", () => {
  it("opens the shutter over the frame before and the frame after, at the measured sub-interval count", async () => {
    const { copies } = await attach();
    const { trailing, leading } = windowEdges(copyOffsets(copies));

    expect(copies).toHaveLength(COPIES);
    expect(trailing).toBeCloseTo(-reference.trailingDisplacementPx, 1);
    expect(leading).toBeCloseTo(reference.leadingDisplacementPx, 1);
  });

  it("spaces the duplicates at the measured staircase pitch", async () => {
    // The reference's staircase is even (15, 16, 16, 15, 16, 16, 16 px across a 125.8 px frame
    // displacement), so a constant-velocity trajectory has to come out evenly spaced at 1/8 frame.
    const speed = reference.trailingDisplacementPx;
    const { copies } = await attach({}, (df) => `matrix(1, 0, 0, 1, ${speed * df}, 0)`);
    const expected = speed / (reference.subIntervalsPerWindow / 2);

    for (const pitch of copyPitches(copyOffsets(copies))) expect(pitch).toBeCloseTo(expected, 3);
  });

  it("gives every duplicate the measured 1/16 opacity and none full opacity", async () => {
    const { copies } = await attach();

    expect(copies).toHaveLength(COPIES);
    for (const copy of copies) {
      expect(Number(copy.style.opacity)).toBeCloseTo(reference.copyOpacity, 6);
      expect(copy.style.mixBlendMode).toBe("plus-lighter");
    }
    // Flat, not tapered: the reference's plateau increments are all the same height.
    expect(new Set(copies.map((copy) => copy.style.opacity)).size).toBe(1);
  });

  it("adds the duplicates among themselves, not onto the page", async () => {
    // plus-lighter adds premultiplied colour, so without a backdrop of its own the first
    // duplicate would add onto whatever is behind the element and blow a light page out to
    // white. The isolation is the only thing standing between the shutter sum and the page.
    const { group } = await attach();

    expect(group.style.isolation).toBe("isolate");
  });

  it("paints the sharp frame-time instance over the accumulated smear", async () => {
    const { group, word } = await attach();

    // Document order is the paint order for positioned siblings at the same z-index, so the
    // group has to precede the element rather than follow it.
    expect(group.nextElementSibling).toBe(word);
    expect(word.style.opacity).toBe("");
  });

  it("carries the element's own opacity on the smear", async () => {
    // A beat that moves and fades at once must not leave a full-strength smear behind a
    // vanishing element. The weight stays on the duplicates; the fade rides the group.
    const { group, copies } = await attach({}, translating, () => "0.25");

    expect(group.style.opacity).toBe("0.25");
    for (const copy of copies)
      expect(Number(copy.style.opacity)).toBeCloseTo(reference.copyOpacity, 6);
  });
});

describe("motion-blur drivers", () => {
  // The output stage carries each duplicate's whole resolved transform, so any property that
  // reaches `transform` smears. The previous stage offset one rasterisation, which meant a beat
  // that only scaled or only rotated sampled a displacement of zero and rendered sharp.
  it("smears a scale beat that never translates", async () => {
    const { copies } = await attach(
      {},
      (df) => `matrix(${1 + df * 0.5}, 0, 0, ${1 + df * 0.5}, 0, 0)`,
    );
    const scales = copies.map((copy) => copy.style.transform);

    expect(new Set(scales).size).toBe(COPIES);
    expect(copies[0]?.style.transform).toContain("matrix(0.5");
  });

  it("smears a 3D rotation beat and gives every duplicate its own perspective", async () => {
    // mix-blend-mode flattens preserve-3d, so a duplicate cannot inherit the parent's 3D
    // context: each one carries the parent's perspective as its own first transform function.
    const { copies } = await attach(
      {},
      (df) =>
        `matrix3d(${Math.cos(df)}, 0, ${Math.sin(df)}, 0, 0, 1, 0, 0, ${-Math.sin(df)}, 0, ${Math.cos(df)}, 0, 0, 0, 0, 1)`,
    );

    expect(new Set(copies.map((copy) => copy.style.transform)).size).toBe(COPIES);
    for (const copy of copies) {
      expect(copy.style.transform.startsWith(`perspective(${PERSPECTIVE})`)).toBe(true);
    }
  });

  it("renders sharp when nothing the transform can express has changed", async () => {
    // The deadband is what keeps a held frame from paying for 17 duplicates of a still element.
    const { group } = await attach({}, () => "matrix(1, 0, 0, 1, 0, 0)");

    expect(group.style.display).toBe("none");
  });

  it("renders sharp below half a pixel of travel", async () => {
    const { group } = await attach({}, (df) => `matrix(1, 0, 0, 1, ${df * 0.1}, 0)`);

    expect(group.style.display).toBe("none");
  });

  it("blurs a target once, however many times it is named", async () => {
    // A second set of copies over the first would double the ink at every sample, so
    // the second call has to leave the element alone rather than stack onto it.
    const { reattach } = await attach();
    reattach();

    expect(document.querySelectorAll("[data-hf-motion-blur]")).toHaveLength(1);
  });

  it("re-reads the copies' styles when the element's box changes", async () => {
    // Container-relative styles (a cqw font size, a cqw perspective) are px by the time
    // they are read, so a preview that resizes after attaching would otherwise keep the
    // smear at the old size for the rest of the render.
    const observer = installResizeObserver();
    let perspective = PERSPECTIVE;
    const { copies, fire } = await attach(
      {},
      translating,
      () => "1",
      () => perspective,
    );
    expect(copies[0]?.style.transform.startsWith(`perspective(${PERSPECTIVE})`)).toBe(true);

    perspective = "900px";
    observer.resize();
    fire();
    await Promise.resolve();

    for (const copy of copies)
      expect(copy.style.transform.startsWith("perspective(900px)")).toBe(true);
  });

  it("disables the smear entirely at shutterAngle 0", async () => {
    const { group } = await attach({ shutterAngle: 0 });

    expect(group.style.display).toBe("none");
  });
});
