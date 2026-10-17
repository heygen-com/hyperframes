// @vitest-environment jsdom
import { gsap } from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hideTimedClipsUntilFirstPass,
  revealTimedClipsAfterFirstPass,
  setTimedClipVisibility,
  showHiddenClipFilters,
} from "@hyperframes/core/runtime/timed-clip-hide";
import { init } from "./hyper-shader.js";
import { stubWebGl } from "./testWebGl.js";

const capture = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./capture.js", () => ({
  initCapture: vi.fn(),
  captureScene: (...args: unknown[]) => capture.run(...args),
}));

afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  gsap.globalTimeline.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  revealTimedClipsAfterFirstPass();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

type Failure = "sample" | "resample" | "restore";

function failsAt(stage: Failure, time: number, suppress: boolean): boolean {
  if (stage === "restore") return time < 1;
  if (time !== 2) return false;
  return stage === (suppress ? "resample" : "sample");
}

function fixture(outer = false, failAt?: Failure) {
  hideTimedClipsUntilFirstPass();
  revealTimedClipsAfterFirstPass();
  document.head.insertAdjacentHTML("beforeend", "<style>#B{filter:opacity(1)}</style>");
  document.body.innerHTML =
    '<div data-composition-id="root" data-duration="6" data-width="640" data-height="360"><div id="s1" class="scene"></div><div id="s2" class="scene"><div id="B" data-start="2" data-duration="3"></div></div></div><iframe></iframe>';
  const b = document.getElementById("B")!;
  const other = document.querySelector("iframe")!.contentDocument!;
  other.body.innerHTML = '<div id="decoy"></div>';
  const decoy = other.getElementById("decoy")!;
  setTimedClipVisibility(decoy, "hidden");
  const observations: { time: number; suppress: boolean; borrowed: boolean; decoy: boolean }[] = [];
  const awaits: boolean[] = [];
  vi.stubGlobal("gsap", gsap);
  stubWebGl();
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
    callback(new Blob(["snapshot"])),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    awaits.push(b.hasAttribute("data-hf-filter-sampling"));
    queueMicrotask(() => callback(0));
    return 1;
  });
  capture.run.mockImplementation(async () => {
    awaits.push(b.hasAttribute("data-hf-filter-sampling"));
    return document.createElement("canvas");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const root = gsap
    .timeline({ paused: true })
    .from(
      b,
      { filter: "opacity(0)", duration: 1, immediateRender: false, lazy: false, ease: "none" },
      2,
    );
  root.to({}, { duration: 6 }, 0);
  root.progress(0.0001, true);
  Reflect.set(window, "__timelines", { root });
  const originalTime = root.time.bind(root);
  vi.spyOn(root, "time").mockImplementation(((time?: number, suppress: boolean = false) => {
    if (time === undefined) return originalTime();
    observations.push({
      time,
      suppress,
      borrowed: b.hasAttribute("data-hf-filter-sampling"),
      decoy: decoy.hasAttribute("data-hf-filter-sampling"),
    });
    if (failAt && failsAt(failAt, time, suppress)) throw new Error(`failed ${failAt}`);
    return originalTime(time, suppress);
  }) as typeof root.time);
  const tl = init({
    bgColor: "#fff",
    scenes: ["s1", "s2"],
    transitions: [{ time: 2, duration: 1, shader: "domain-warp" }],
    timeline: root as unknown as NonNullable<Parameters<typeof init>[0]["timeline"]>,
    previewCaptureFps: 1,
  });
  setTimedClipVisibility(b, "hidden");
  const release = outer ? showHiddenClipFilters(document) : () => {};
  const ready = Reflect.get(window, "__hf").shaderTransitionsReady as Promise<void>;
  return { b, decoy, tl, root, observations, awaits, ready, release };
}

describe("private shader prewarm filter sampling", () => {
  it.each([false, true])(
    "keeps the supplied timeline's authored endpoint (outer borrow=%s)",
    async (outer) => {
      const f = fixture(outer);
      await f.ready;
      const samples = f.observations.slice();
      const retainedOuter = f.b.hasAttribute("data-hf-filter-sampling");
      const restoredTime = f.tl.time();
      f.release();
      setTimedClipVisibility(f.b, "visible");
      f.tl.time(3.5);
      expect(f.b.style.filter).toBe("opacity(1)");
      expect(f.observations.at(-1)?.borrowed).toBe(false);
      expect(f.awaits.length).toBeGreaterThan(0);
      expect(samples.map(({ time, suppress }) => [time, suppress])).toEqual([
        [2, false],
        [2, true],
        [3, false],
        [3, true],
        [0.0006, false],
      ]);
      expect(samples.every(({ borrowed, decoy }) => borrowed && !decoy)).toBe(true);
      expect(retainedOuter).toBe(outer);
      expect(f.awaits.every((borrowed) => borrowed === outer)).toBe(true);
      expect(restoredTime).toBeCloseTo(0.0006, 7);
      expect(f.tl).toBe(f.root);
      expect(document.getElementById("gl-canvas")!.style.display).toBe("none");
    },
  );

  it("restores a public seek requested during capture without borrowing across the await", async () => {
    const f = fixture();
    capture.run.mockImplementation(async () => {
      expect(f.b.hasAttribute("data-hf-filter-sampling")).toBe(false);
      f.tl.time(4);
      return document.createElement("canvas");
    });
    await f.ready;
    expect(f.tl.time()).toBe(4);
    expect(f.observations.at(-1)).toMatchObject({ time: 4, borrowed: true });
    expect(f.b.hasAttribute("data-hf-filter-sampling")).toBe(false);
    setTimedClipVisibility(f.b, "visible");
    expect(f.b.style.filter).toBe("opacity(1)");
  });

  it.each([
    ["sample", false],
    ["resample", false],
    ["restore", false],
    ["sample", true],
    ["resample", true],
    ["restore", true],
  ] as const)(
    "releases only owned flags after a %s error (outer borrow=%s)",
    async (failure, outer) => {
      const f = fixture(outer, failure);
      await f.ready;
      expect(f.observations.every(({ borrowed, decoy }) => borrowed && !decoy)).toBe(true);
      expect(f.b.hasAttribute("data-hf-filter-sampling")).toBe(outer);
      expect(f.b.style.visibility).toBe("hidden");
      expect(f.decoy.hasAttribute("data-hf-filter-sampling")).toBe(false);
      expect(f.awaits.every((borrowed) => borrowed === outer)).toBe(true);
      f.release();
      expect(f.b.hasAttribute("data-hf-filter-sampling")).toBe(false);
    },
  );
});
