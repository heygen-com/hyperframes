// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import reference from "./__fixtures__/motion-blur-ae-reference.json";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const snippetHtml = readRepoFile("registry/components/motion-blur/motion-blur.html");

const SNIPPET_START = "/* SHUTTER_SNIPPET_START */";
const SNIPPET_END = "/* SHUTTER_SNIPPET_END */";

/** The snippet verbatim, between its own sentinel comments. In a copy the snippet shares one
 *  IIFE with that composition's timeline code, so no brace or closer can tell the two apart:
 *  the delimiters have to be written down. */
function snippetSource(source: string): string {
  const start = source.indexOf(SNIPPET_START);
  if (start < 0) throw new Error(`could not locate ${SNIPPET_START}`);
  const end = source.indexOf(SNIPPET_END, start);
  if (end < 0) throw new Error(`could not locate ${SNIPPET_END}`);
  return source.slice(start, end + SNIPPET_END.length);
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

interface Fake {
  tl: Timeline;
  currentTime: () => number;
  fire: () => void;
  /** How many tracker tweens the snippet installed. A call that blurs nothing installs none. */
  trackers: () => number;
}

function makeTimeline(onTo?: () => void): Fake {
  let now = FRAME_TIME_S;
  let onUpdate: (() => void) | undefined;
  let trackers = 0;
  const tl: Timeline = {
    time(value?: number) {
      if (value === undefined) return now;
      now = value;
      return tl;
    },
    duration: () => DURATION_S,
    to(_target, vars) {
      onTo?.();
      trackers += 1;
      onUpdate = vars.onUpdate;
      return tl;
    },
  };
  return { tl, currentTime: () => now, fire: () => onUpdate?.(), trackers: () => trackers };
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

/** Captures the observers the snippet installs so a test can fire a resize itself, and
 *  counts the ones still connected: an observer left on an element nothing blurs keeps
 *  walking N+1 detached subtrees on every resize. */
function installResizeObserver(): { resize: () => void; live: () => number } {
  const callbacks = new Set<() => void>();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    private readonly callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      callbacks.add(callback);
    }
    observe(): void {}
    disconnect(): void {
      callbacks.delete(this.callback);
    }
  };
  return {
    resize: () => {
      for (const callback of callbacks) callback();
    },
    live: () => callbacks.size,
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
  const group = document.querySelector<HTMLElement>("[data-hf-motion-blur-group]");
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

beforeEach(() => {
  // The snippet polls the registry on a timer for seconds. Fake timers let a test reach the
  // end of that budget, and let this file drain one test's poll before the next starts.
  vi.useFakeTimers();
});

afterEach(async () => {
  document.body.innerHTML = "";
  // Each install leaves a poll running. A pending one would otherwise fire inside a later
  // test against that test's document, so it is drained here over an emptied body.
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  globalThis.getComputedStyle = originalGetComputedStyle;
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  // The registration hook and its one-shot guard live on window, so without this the
  // second test in the file would run against the first test's accessor.
  delete (window as unknown as { _hfMbHooked?: boolean })._hfMbHooked;
  delete (window as unknown as { __timelines?: unknown }).__timelines;
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

    expect(document.querySelectorAll("[data-hf-motion-blur-group]")).toHaveLength(1);
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

/** A composition with one declaratively marked target, and the pieces to drive it. */
interface Declared {
  word: HTMLElement;
  root: HTMLElement;
  /** The composition's own timeline, for a test that has to call the imperative form. */
  tl: Timeline;
  trackers: () => number;
  register: (key?: string, value?: unknown) => void;
  fire: () => void;
  groups: () => HTMLElement[];
  settle: () => Promise<void>;
}

const COMPOSITION = "declarative-composition";
/** The snippet's own budget, 250 ticks of 32 ms, plus one tick of slack. */
const POLL_BUDGET_MS = 250 * 32 + 32;

function declare(
  attribute: string | null,
  compositionId: string = COMPOSITION,
  rootFps: number | null = null,
): Declared {
  const root = document.createElement("div");
  root.setAttribute("data-composition-id", compositionId);
  if (rootFps !== null) root.setAttribute("data-fps", String(rootFps));
  document.body.appendChild(root);
  const word = document.createElement("div");
  word.id = "word";
  if (attribute !== null) word.setAttribute("data-hf-motion-blur", attribute);
  Object.defineProperty(word, "offsetWidth", { value: WORD_WIDTH });
  Object.defineProperty(word, "offsetHeight", { value: WORD_HEIGHT });
  Object.defineProperty(word, "offsetLeft", { value: 437 });
  Object.defineProperty(word, "offsetTop", { value: 442 });
  root.appendChild(word);

  const { tl, currentTime, fire, trackers } = makeTimeline();
  installComputedStyle(
    word,
    currentTime,
    translating,
    () => "1",
    () => PERSPECTIVE,
  );
  installSnippet();

  const host = window as unknown as { __timelines?: Record<string, unknown> };
  return {
    word,
    root,
    tl,
    trackers,
    fire,
    // The authoring boilerplate verbatim, self-assignment included: those two writes are
    // what the snippet has to intercept.
    register: (key: string = compositionId, value: unknown = tl) => {
      host.__timelines = host.__timelines ?? {};
      (host.__timelines as Record<string, unknown>)[key] = value;
    },
    groups: () => [...document.querySelectorAll<HTMLElement>("[data-hf-motion-blur-group]")],
    // Runs the snippet's whole polling budget, which is how the unclaimed-target warning
    // is reached. Fake timers, because the real budget is seconds of wall clock.
    settle: async () => {
      await vi.advanceTimersByTimeAsync(POLL_BUDGET_MS);
    },
  };
}

describe("motion-blur declarative attribute", () => {
  it("attaches on timeline registration, with no attachMotionBlur call", async () => {
    // The ordering contract is the whole point: registering the timeline is the moment the
    // author has finished building it, so the attribute has no order to get wrong.
    const target = declare("");
    expect(target.groups()).toHaveLength(0);

    target.register();
    target.fire();
    await Promise.resolve();

    const [group] = target.groups();
    expect(group?.children).toHaveLength(COPIES);
    expect(group?.style.display).toBe("");
  });

  it("reads its options out of the attribute", async () => {
    const target = declare('{"samplesPerFrame": 4}');
    target.register();
    target.fire();
    await Promise.resolve();

    expect(target.groups()[0]?.children).toHaveLength(5);
  });

  it("leaves a target alone when another composition registers", async () => {
    // One page can hold several compositions, and a target belongs to the nearest one.
    const target = declare("");
    target.register("some-other-composition");

    expect(target.groups()).toHaveLength(0);
  });

  it("leaves a target alone when the registered value is not a timeline", async () => {
    const target = declare("");
    target.register(COMPOSITION, { notATimeline: true });

    expect(target.groups()).toHaveLength(0);
  });

  it("does not sweep its own copies as targets", async () => {
    // A copy is cloned from the target, attribute included, so without stripping it the
    // sweep would attach a second group inside the first one's.
    const target = declare("");
    target.register();
    target.fire();
    await Promise.resolve();
    target.register();

    expect(target.groups()).toHaveLength(1);
    const [group] = target.groups();
    for (const copy of [...(group?.children ?? [])]) {
      expect(copy.hasAttribute("data-hf-motion-blur")).toBe(false);
    }
  });

  it("blurs once when the attribute and attachMotionBlur name the same element", async () => {
    const target = declare("");
    target.register();
    const attachBlur = (
      window as unknown as { attachMotionBlur: (s: string, t: unknown, o: unknown) => void }
    ).attachMotionBlur;
    attachBlur("#word", makeTimeline().tl, { fps: FPS });

    expect(target.groups()).toHaveLength(1);
  });

  it("warns instead of silently rendering sharp when no composition claims a target", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare("", "a-composition-that-never-registers");
    await target.settle();

    expect(target.groups()).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "no composition registered a timeline for them",
    );
    warn.mockRestore();
  });

  it("warns and skips a value that is not JSON, rather than reading it as defaults", async () => {
    // A typo in the options would otherwise blur with the wrong shutter, or not at all,
    // with nothing on the console to say which.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare("{samplesPerFrame: 4}");
    target.register();

    expect(target.groups()).toHaveLength(0);
    expect(String(warn.mock.calls[0]?.[0])).toContain("is not JSON");

    // Already reported, so the load-time sweep must not report it a second time.
    warn.mockClear();
    await target.settle();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not stack a proxy when the registry is assigned back to itself", () => {
    // `window.__timelines = window.__timelines || {}` is the documented boilerplate, so the
    // interception sees its own result handed back and must not wrap it a second time.
    const target = declare("");
    target.register();
    const host = window as unknown as { __timelines?: Record<string, unknown> };
    const first = host.__timelines;

    host.__timelines = host.__timelines ?? {};

    expect(host.__timelines).toBe(first);
  });

  it("says nothing when every target was claimed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare("");
    target.register();
    await target.settle();

    expect(target.groups()).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("motion-blur declarative attribute, the cases only executing found", () => {
  it("refuses a target inside another target, and keeps no attribute on a copy", async () => {
    // The inner target's group would be inserted into the LIVE outer element, so the outer's
    // style replay would walk a subtree its own copies no longer match. And a copy is a deep
    // clone, so the attribute rides along on descendants unless it is stripped there too.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare("");
    const child = document.createElement("span");
    child.setAttribute("data-hf-motion-blur", "");
    Object.defineProperty(child, "offsetWidth", { value: 10 });
    Object.defineProperty(child, "offsetHeight", { value: 10 });
    target.word.appendChild(child);

    target.register();
    target.register();

    expect(target.groups()).toHaveLength(1);
    expect(
      document.querySelectorAll("[data-hf-motion-blur-group] [data-hf-motion-blur]"),
    ).toHaveLength(0);
    await target.settle();

    // Once, not once per sweep: the refusal is terminal, so the poll must not re-report it,
    // and it must not be counted as a target still waiting for a timeline.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("inside another");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("no composition registered");
    warn.mockRestore();
  });

  it("attaches a target whose composition mounts after its timeline is registered", async () => {
    // A sub-composition registers and then its DOM arrives. Both triggers are write-driven,
    // so the poll has to survive a tick on which nothing was pending.
    const target = declare("");
    target.register();
    await vi.advanceTimersByTimeAsync(64);
    expect(target.groups()).toHaveLength(1);

    const { tl } = makeTimeline();
    target.register("second-composition", tl);
    const host = document.createElement("div");
    host.setAttribute("data-composition-id", "second-composition");
    const late = document.createElement("div");
    late.setAttribute("data-hf-motion-blur", "");
    Object.defineProperty(late, "offsetWidth", { value: WORD_WIDTH });
    Object.defineProperty(late, "offsetHeight", { value: WORD_HEIGHT });
    host.appendChild(late);
    document.body.appendChild(host);

    await vi.advanceTimersByTimeAsync(64);

    expect(target.groups()).toHaveLength(2);
  });

  it("warns once about a second timeline, not once per poll tick", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare("");
    target.register();
    target.register(COMPOSITION, makeTimeline().tl);

    await vi.advanceTimersByTimeAsync(POLL_BUDGET_MS);

    const second = warn.mock.calls.filter((call) => String(call[0]).includes("second timeline"));
    expect(second).toHaveLength(1);
    warn.mockRestore();
  });

  it("blames the attribute, not the composition, when a value is malformed", async () => {
    // The parse has to happen before the timeline lookup, or an unclaimed composition hides
    // the real cause behind a warning that points at the wrong thing.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    declare("{bad}", "a-composition-that-never-registers");

    await vi.advanceTimersByTimeAsync(POLL_BUDGET_MS);

    const said = warn.mock.calls.map((call) => String(call[0])).join(" ");
    expect(said).toContain("is not JSON");
    expect(said).not.toContain("no composition registered");
    warn.mockRestore();
  });

  it.each(["null", "720", '"shutterAngle"', "[]"])(
    "warns and skips %s, rather than reading it as defaults",
    async (value) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const target = declare(value);
      target.register();

      expect(target.groups()).toHaveLength(0);
      expect(String(warn.mock.calls[0]?.[0])).toContain("is not a JSON object");
      warn.mockRestore();
    },
  );

  it("warns when a second timeline is registered for an element it already blurred", async () => {
    // The copies keep following the first timeline. Nobody seeks it, so they render sharp,
    // and without this the only signal is a composition that quietly lost its blur.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare("");
    target.register();
    expect(target.groups()).toHaveLength(1);

    target.register(COMPOSITION, makeTimeline().tl);

    expect(target.groups()).toHaveLength(1);
    expect(warn.mock.calls.map((call) => String(call[0])).join(" ")).toContain("second timeline");
    warn.mockRestore();
  });

  it("attaches a registration the write trap cannot see", async () => {
    // The runtime owns the registry object and wraps it per sub-composition, so a write can
    // land on the raw object without passing through the accessor. Polling needs no
    // cooperation from whoever writes it.
    const host = window as unknown as { __timelines?: Record<string, unknown> };
    host.__timelines = {};
    const raw = host.__timelines;
    const target = declare("");
    const { tl } = makeTimeline();

    raw[COMPOSITION] = tl;
    expect(target.groups()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(64);

    expect(target.groups()).toHaveLength(1);
  });

  it("does not warn about a target whose composition registers late", async () => {
    // Nested compositions mount asynchronously, well after load, so a warning keyed to load
    // would fire on a composition that was about to arrive.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare("");

    await vi.advanceTimersByTimeAsync(2000);
    expect(warn).not.toHaveBeenCalled();

    target.register();
    await vi.advanceTimersByTimeAsync(POLL_BUDGET_MS);

    expect(target.groups()).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reads the frame rate of its own composition, not the first one in the document", async () => {
    // `resolveFps` used a document-wide query while the timeline came from the NEAREST
    // composition root, so a second composition on the page inherited the first one's rate
    // and got a shutter window half or double the length it asked for.
    const decoy = document.createElement("div");
    decoy.setAttribute("data-composition-id", "a-faster-composition");
    decoy.setAttribute("data-fps", String(FPS * 2));
    document.body.appendChild(decoy);

    const target = declare("", COMPOSITION, FPS);
    target.register();
    target.fire();
    await Promise.resolve();

    const group = target.groups()[0];
    if (!group) throw new Error("motion-blur group was not created");
    const { trailing, leading } = windowEdges(copyOffsets([...group.children] as HTMLElement[]));

    expect(trailing).toBeCloseTo(-reference.trailingDisplacementPx, 1);
    expect(leading).toBeCloseTo(reference.leadingDisplacementPx, 1);
  });

  it("refuses an option name it does not know instead of rendering with the defaults", async () => {
    // The likeliest typo in a JSON object is the key, and reading it as defaults is exactly
    // the silent no-op the attribute exists to remove.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare('{"samplesperframe": 4}');

    target.register();
    await target.settle();

    expect(target.groups()).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("samplesperframe");
    warn.mockRestore();
  });

  it("survives a marked element whose parent is not an element", async () => {
    // `document.documentElement.parentNode` is the Document, which has no `closest`, so the
    // nesting check threw a TypeError on a marked root. The sweep's own boundary now catches
    // anything thrown; this guard is what keeps the element's own message the honest one.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.documentElement.setAttribute("data-hf-motion-blur", "");
    try {
      const target = declare(null);

      expect(() => target.register()).not.toThrow();
      await target.settle();

      // The poll reached its deadline, which it could only do if it was installed at all.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("no composition registered");
    } finally {
      document.documentElement.removeAttribute("data-hf-motion-blur");
      warn.mockRestore();
    }
  });

  it("does not let one unblurrable target abort the author's registration statement", async () => {
    // The write trap runs the sweep INSIDE `window.__timelines[id] = tl`, so a throw here
    // would take the rest of the author's composition script with it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare("");
    const host = window as unknown as { attachMotionBlur: (...args: unknown[]) => void };
    const real = host.attachMotionBlur;
    host.attachMotionBlur = () => {
      throw new Error("no");
    };

    expect(() => target.register()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("could not blur");

    host.attachMotionBlur = real;
    warn.mockRestore();
  });

  it.each([
    ['{"shutterAngle": "720deg"}', "shutterAngle"],
    ['{"shutterPhase": "-360deg"}', "shutterPhase"],
    ['{"fps": {"n": 30}}', "fps"],
  ])("refuses %s, whose value the shutter cannot use", async (value, name) => {
    // Checking the key name and not the value left the worse half of the same typo: a
    // non-numeric angle hides the smear, and a non-numeric phase seeks every copy to NaN,
    // which under real GSAP parks 17 copies at the timeline's start position.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare(value);

    target.register();
    await target.settle();

    expect(target.groups()).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("needs a number for " + name);
    warn.mockRestore();
  });

  it("installs no tracker for a call that blurs nothing", async () => {
    // A second call on an already-blurred element used to install another tracker, and a
    // tracker runs the whole sample loop on every seek over a set it does not own.
    const target = declare("");
    target.register();
    expect(target.trackers()).toBe(1);

    const attachBlur = (
      window as unknown as { attachMotionBlur: (s: unknown, t: unknown, o?: unknown) => void }
    ).attachMotionBlur;
    attachBlur(target.word, target.tl, {});
    attachBlur("#nothing-matches-this", target.tl, {});

    expect(target.trackers()).toBe(1);
    expect(target.groups()).toHaveLength(1);
  });

  it("leaves no copies and no mark behind when an attach throws partway", async () => {
    // The sweep's boundary stops a throw from aborting the author's registration statement,
    // but the element must not be left marked-attached with a group and no tracker: that is
    // sharp forever, with no retry, and the copies still in the DOM.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const observers = installResizeObserver();
    const target = declare("");
    const doomed = makeTimeline(() => {
      throw new Error("no tracker for you");
    });

    target.register(COMPOSITION, doomed.tl);

    expect(target.groups()).toHaveLength(0);
    expect(document.querySelectorAll("[data-hf-motion-blur-group]")).toHaveLength(0);
    expect(observers.live()).toBe(0);
    expect(String(warn.mock.calls[0]?.[0])).toContain("could not blur");

    // The mark is given back, so the imperative form can still rescue the element. The
    // DECLARATIVE path does not retry: the sweep records the failure as skipped, which
    // `handled()` reads, and a throw is reported once rather than retried for eight seconds.
    const rescue = makeTimeline();
    const attachBlur = (
      window as unknown as { attachMotionBlur: (s: unknown, t: unknown, o?: unknown) => void }
    ).attachMotionBlur;
    attachBlur(target.word, rescue.tl, {});

    expect(target.groups()).toHaveLength(1);
    expect(rescue.trackers()).toBe(1);
    expect(observers.live()).toBe(1);
    warn.mockRestore();
  });

  it("warns when one call names compositions at different frame rates", async () => {
    // One seek loop drives the whole call, so the shutter window is one length. Two roots
    // at different rates cannot both be right, and silently using the first is what the
    // document-wide lookup used to do.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare(null, COMPOSITION, FPS);
    const other = document.createElement("div");
    other.setAttribute("data-composition-id", "a-faster-composition");
    other.setAttribute("data-fps", String(FPS * 2));
    document.body.appendChild(other);
    const fast = document.createElement("div");
    Object.defineProperty(fast, "offsetWidth", { value: 10 });
    Object.defineProperty(fast, "offsetHeight", { value: 10 });
    other.appendChild(fast);

    const { tl } = makeTimeline();
    const attachBlur = (
      window as unknown as { attachMotionBlur: (s: unknown, t: unknown, o?: unknown) => void }
    ).attachMotionBlur;
    attachBlur([target.word, fast], tl, {});

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("different frame rates");
    warn.mockRestore();
  });

  it("does not blame the composition for a nested target claimed on the last poll tick", async () => {
    // `refuse` returns null, so returning it from the nesting branch pushes the element into
    // `pending`. Invisible on every tick but the last, which is the one the deadline warning
    // reads, so the refusal arrives with a second line blaming a composition that did register.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare(null);
    target.register();
    await vi.advanceTimersByTimeAsync(249 * 32);

    const outer = document.createElement("div");
    outer.setAttribute("data-hf-motion-blur", "");
    Object.defineProperty(outer, "offsetWidth", { value: 40 });
    Object.defineProperty(outer, "offsetHeight", { value: 40 });
    const inner = document.createElement("span");
    inner.setAttribute("data-hf-motion-blur", "");
    Object.defineProperty(inner, "offsetWidth", { value: 10 });
    Object.defineProperty(inner, "offsetHeight", { value: 10 });
    outer.appendChild(inner);
    target.root.appendChild(outer);

    await vi.advanceTimersByTimeAsync(POLL_BUDGET_MS);

    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines.filter((line) => line.includes("inside another"))).toHaveLength(1);
    expect(lines.filter((line) => line.includes("no composition registered"))).toHaveLength(0);
    warn.mockRestore();
  });

  it("takes the frame rate from an element it attached, not the first one it was handed", async () => {
    // `targets[0]` can be an element this call does NOT blur, because an already-blurred
    // element is skipped. Reading its root gives the whole call the wrong window length.
    const faster = document.createElement("div");
    faster.setAttribute("data-composition-id", "already-blurred-and-faster");
    faster.setAttribute("data-fps", String(FPS * 2));
    document.body.appendChild(faster);
    const done = document.createElement("div");
    faster.appendChild(done);

    const target = declare("", COMPOSITION, FPS);
    const attachBlur = (
      window as unknown as { attachMotionBlur: (s: unknown, t: unknown, o?: unknown) => void }
    ).attachMotionBlur;
    attachBlur(done, makeTimeline().tl, {});

    attachBlur([done, target.word], target.tl, {});
    target.fire();
    await Promise.resolve();

    const group = [...document.querySelectorAll<HTMLElement>("[data-hf-motion-blur-group]")].at(-1);
    if (!group) throw new Error("motion-blur group was not created");
    const { trailing, leading } = windowEdges(copyOffsets([...group.children] as HTMLElement[]));

    expect(trailing).toBeCloseTo(-reference.trailingDisplacementPx, 1);
    expect(leading).toBeCloseTo(reference.leadingDisplacementPx, 1);
  });

  it("puts no copies in the page when the style walk itself throws", async () => {
    // The rollback can only remove records `attachOne` RETURNED. A throw between the insert
    // and the return leaves a group nothing owns, and the element unmarked, so a later
    // trigger inserts a second one. Inserting after the snapshot is what closes that.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const target = declare("");
    const real = globalThis.getComputedStyle;
    globalThis.getComputedStyle = ((element: Element) => {
      if (element === target.word) throw new Error("no styles for you");
      return real(element);
    }) as typeof globalThis.getComputedStyle;

    try {
      target.register();

      expect(document.querySelectorAll("[data-hf-motion-blur-group]")).toHaveLength(0);
      expect(String(warn.mock.calls[0]?.[0])).toContain("could not blur");
    } finally {
      globalThis.getComputedStyle = real;
      warn.mockRestore();
    }
  });
});
