import { describe, expect, it } from "vitest";
import {
  MOTION_BLUR_LIMITS,
  type ElementMotionBlurSettings,
  type MotionBlurMode,
  elementMotionBlurAttributeEdits,
  readElementMotionBlurSettings,
  resolveMoverSettings,
} from "../../motionBlurSettings";
import { discoverMovers } from "./discover";
import { readMoverFrames, shutterTimes } from "./frames";
import { createPoseReader } from "./pose";

function makeBox(parent: Element, id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  parent.append(el);
  el.getBoundingClientRect = () => {
    const x = parseFloat(el.style.transform.replace("translateX(", "")) || 0;
    return { left: x, top: 0, right: x + 10, bottom: 10, width: 10, height: 10 } as DOMRect;
  };
  return el;
}

describe("formal verification: motion blur contracts and state invariants", () => {
  it("verifies settings parsing, clamping, and round-trip invariants across boundary and invalid inputs", () => {
    const modes: Array<string | null> = [null, "", "on", "off", "true", "ON", "invalid"];
    const shutters: Array<string | null> = [
      null,
      "",
      "0",
      "240",
      "720",
      "-100",
      "9999",
      "123.5",
      "NaN",
      "Infinity",
      "wide",
    ];
    const samples: Array<string | null> = [null, "", "1", "2", "32", "64", "100", "10.6", "bad"];

    for (const m of modes) {
      for (const sh of shutters) {
        for (const sa of samples) {
          const parsed = readElementMotionBlurSettings((name) => {
            if (name === "data-motion-blur") return m;
            if (name === "data-motion-blur-shutter") return sh;
            if (name === "data-motion-blur-samples") return sa;
            return null;
          });

          expect(["on", "off", "inherit"]).toContain(parsed.mode);
          if (parsed.shutterDeg !== null) {
            expect(parsed.shutterDeg).toBeGreaterThanOrEqual(MOTION_BLUR_LIMITS.shutterDeg.min);
            expect(parsed.shutterDeg).toBeLessThanOrEqual(MOTION_BLUR_LIMITS.shutterDeg.max);
            expect(Number.isFinite(parsed.shutterDeg)).toBe(true);
          }
          if (parsed.samples !== null) {
            expect(Number.isInteger(parsed.samples)).toBe(true);
            expect(parsed.samples).toBeGreaterThanOrEqual(MOTION_BLUR_LIMITS.samples.min);
            expect(parsed.samples).toBeLessThanOrEqual(MOTION_BLUR_LIMITS.samples.max);
          }

          const edits = elementMotionBlurAttributeEdits(parsed);
          const roundTrip = readElementMotionBlurSettings((name) => edits[name] ?? null);
          expect(roundTrip).toEqual(parsed);
        }
      }
    }
  });

  it("verifies resolveMoverSettings fallback and override invariants", () => {
    const root = { shutterDeg: 240, phaseDeg: -120, samples: null };
    const validModes: MotionBlurMode[] = ["on", "off", "inherit"];
    const validShutters: Array<number | null> = [null, 0, 180, 720];
    const validSamples: Array<number | null> = [null, 2, 32, 64];

    for (const mode of validModes) {
      for (const shutterDeg of validShutters) {
        for (const samples of validSamples) {
          const elSettings: ElementMotionBlurSettings = { mode, shutterDeg, samples };
          const edits = elementMotionBlurAttributeEdits(elSettings);
          const resolved = resolveMoverSettings((name) => edits[name] ?? null, root);
          expect(resolved.shutterDeg).toBe(shutterDeg ?? root.shutterDeg);
          expect(resolved.phaseDeg).toBe(root.phaseDeg);
          expect(resolved.samples).toBe(samples ?? root.samples);
        }
      }
    }
  });

  it("exhaustively verifies discovery invariants across all (rootEnabled, parentAttr, childAttr, parentSpeed, childSpeed) states", () => {
    const attrs: Array<"on" | "off" | null> = ["on", "off", null];
    const speeds = [0, 0.5, 10] as const; // still, sub-threshold, fast (px/frame at 30fps)

    for (const rootEnabled of [true, false]) {
      for (const pAttr of attrs) {
        for (const cAttr of attrs) {
          for (const pSpeed of speeds) {
            for (const cSpeed of speeds) {
              const scene = document.createElement("div");
              const parent = makeBox(scene, "parent");
              const child = makeBox(parent, "child");
              if (pAttr) parent.setAttribute("data-motion-blur", pAttr);
              if (cAttr) child.setAttribute("data-motion-blur", cAttr);

              const seek = (t: number): void => {
                parent.style.transform = pSpeed > 0 ? `translateX(${pSpeed * 30 * t}px)` : "";
                child.style.transform = cSpeed > 0 ? `translateX(${cSpeed * 30 * t}px)` : "";
              };
              seek(0);

              const { movers } = discoverMovers({
                scene,
                durationSeconds: 1,
                fps: 30,
                rootEnabled,
                seek,
              });

              // Invariant 1: opt-out dominance (off element and its descendants are never movers)
              if (pAttr === "off") {
                expect(movers).not.toContain(parent);
                expect(movers).not.toContain(child);
              }
              if (cAttr === "off") {
                expect(movers).not.toContain(child);
              }

              // Invariant 2: root-off isolation
              if (!rootEnabled) {
                for (const m of movers) {
                  expect(m.getAttribute("data-motion-blur")).toBe("on");
                }
              }

              // Invariant 3: outermost-wins (no mover contains another mover)
              for (const a of movers) {
                for (const b of movers) {
                  if (a !== b) expect(a.contains(b)).toBe(false);
                }
              }

              // Invariant 4: stillness exclusion (zero-speed element is never a mover)
              if (pSpeed === 0) expect(movers).not.toContain(parent);
              if (cSpeed === 0) expect(movers).not.toContain(child);

              // Invariant 5: sub-threshold opt-in inclusion
              if (pAttr === "on" && pSpeed > 0) {
                expect(movers).toEqual([parent]);
              }
            }
          }
        }
      }
    }
  });

  it("verifies readMoverFrames single-pass fast path and multi-window isolation", () => {
    const scene = document.createElement("div");
    const a = makeBox(scene, "a");
    const b = makeBox(scene, "b");
    Object.defineProperty(a, "offsetWidth", { value: 10 });
    Object.defineProperty(a, "offsetHeight", { value: 10 });
    Object.defineProperty(b, "offsetWidth", { value: 10 });
    Object.defineProperty(b, "offsetHeight", { value: 10 });

    const reader = createPoseReader(scene, new Set([a, b]));
    let seekCount = 0;
    const seek = (t: number): void => {
      seekCount++;
      a.style.transform = `translateX(${100 * t}px)`;
      b.style.transform = `translateX(${100 * t}px)`;
    };

    const rootTimes = shutterTimes(240, null, 30);
    // Same window for both movers -> single pass (4 reads + 1 restore = 5 seeks)
    readMoverFrames({
      movers: [a, b],
      reader,
      seek,
      t: 0.5,
      reads: 4,
      ...rootTimes,
      taps: null,
      moverOverrides: [
        { ...rootTimes, taps: null },
        { ...rootTimes, taps: null },
      ],
      frameW: 640,
      frameH: 360,
    });
    expect(seekCount).toBe(5);

    // Zero-shutter override excludes that mover without affecting the other
    seekCount = 0;
    const res = readMoverFrames({
      movers: [a, b],
      reader,
      seek,
      t: 0.5,
      reads: 4,
      ...rootTimes,
      taps: null,
      moverOverrides: [
        { shutterSeconds: 0, phaseSeconds: 0, taps: null },
        { ...rootTimes, taps: 16 },
      ],
      frameW: 640,
      frameH: 360,
    });
    expect(res.els).toEqual([b]);
    expect(res.frames[0]?.taps).toHaveLength(16);
    expect(seekCount).toBe(5);
  });
});
