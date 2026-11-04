// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { measuredInMotion, readContrastMotion } from "./contrastMotion.js";

function stage(labelOpacity: number): { cam: HTMLElement; card: HTMLElement; label: HTMLElement } {
  document.body.innerHTML = `<div id="cam"><div id="card"><span id="label" style="opacity:${labelOpacity}">Revenue</span></div></div><span id="other">Other</span>`;
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  return { cam: byId("cam"), card: byId("card"), label: byId("label") };
}

function prepared(...elements: Element[]): void {
  Reflect.set(
    window,
    "__contrastAuditRestores",
    elements.map((el) => ({ el })),
  );
}

interface RealTimeline {
  to(target: Element | object, vars: Record<string, unknown>, position?: number): RealTimeline;
  add(child: RealTimeline, position: number): RealTimeline;
  timeScale(value: number): RealTimeline;
  totalTime(value: number, suppressEvents: boolean): RealTimeline;
  pause(): RealTimeline;
  kill(): void;
}
const coreRequire = createRequire(resolve(__dirname, "../../../core/package.json"));
window.eval(readFileSync(coreRequire.resolve("gsap/dist/gsap.js"), "utf8"));
// The evaluated UMD bundle exposes GSAP across the browser-script boundary.
const realGsap = Reflect.get(window, "gsap") as unknown as {
  timeline(vars: Record<string, unknown>): RealTimeline;
  ticker: { sleep(): void };
};

describe("real GSAP sample clocks", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__timelines");
    Reflect.deleteProperty(window, "__contrastAuditRestores");
    realGsap.ticker.sleep();
  });

  it.each([
    { name: "scaled root", scale: 2, repeat: 0, yoyo: false, time: 1.5 },
    { name: "root repeat", scale: 1, repeat: 1, yoyo: false, time: 5.5 },
    { name: "root yoyo", scale: 1, repeat: 1, yoyo: true, time: 6.5 },
  ])("detects motion on a $name", ({ scale, repeat, yoyo, time }) => {
    const { label } = stage(1);
    const root = realGsap.timeline({ paused: true, repeat, yoyo });
    root.to(label, { x: 100, duration: 1 }, 1).to({}, { duration: 1 }, 3);
    root.timeScale(scale).totalTime(time, true);
    Reflect.set(window, "__timelines", { root });
    prepared(label);
    try {
      const sample = readContrastMotion()[0];
      expect(sample).not.toBeNull();
      expect(sample && measuredInMotion(sample)).toBe(true);
    } finally {
      root.kill();
    }
  });
});

describe("contrast motion policy with real GSAP", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__timelines");
    Reflect.deleteProperty(window, "__contrastAuditRestores");
    realGsap.ticker.sleep();
  });

  it.each([
    { name: "nested scaled tween", time: 2.75, repeat: 0, yoyo: false, expected: true },
    { name: "nested tween settled", time: 3.5, repeat: 0, yoyo: false, expected: false },
    { name: "nested repeat", time: 4.25, repeat: 1, yoyo: false, expected: true },
    { name: "nested yoyo", time: 3.75, repeat: 1, yoyo: true, expected: true },
    { name: "nested repeat delay", time: 3.25, repeat: 1, yoyo: false, expected: false },
  ])("samples $name", ({ time, repeat, yoyo, expected }) => {
    const { card, label } = stage(1);
    const root = realGsap.timeline({ paused: true });
    const scene = realGsap.timeline({ repeat, yoyo, repeatDelay: 1 });
    scene.to(card, { x: 100, duration: 1 }, 1).timeScale(2);
    root.add(scene, 2).to({}, { duration: 1 }, 8).totalTime(time, true);
    Reflect.set(window, "__timelines", { root, scene });
    prepared(label);
    try {
      const sample = readContrastMotion()[0];
      expect(sample?.tweens).toHaveLength(1);
      expect(sample && measuredInMotion(sample)).toBe(expected);
    } finally {
      root.kill();
    }
  });

  it.each([
    { duration: 4, repeat: 0, opacity: 1, expected: false },
    { duration: 3.999, repeat: 0, opacity: 1, expected: true },
    { duration: 1, repeat: -1, opacity: 1, expected: false },
    { duration: 1, repeat: 2, opacity: 1, expected: false },
    { duration: 4, repeat: 0, opacity: 0.6, expected: true },
    { duration: 4, repeat: 0, opacity: 0.9996, expected: false },
  ])("preserves ambient and opacity policy: %j", ({ duration, repeat, opacity, expected }) => {
    const { card, label } = stage(opacity);
    const root = realGsap.timeline({ paused: true });
    root.to(card, { x: 100, duration, repeat }).totalTime(0.5, true);
    Reflect.set(window, "__timelines", { root });
    prepared(label);
    try {
      const sample = readContrastMotion()[0];
      expect(sample && measuredInMotion(sample)).toBe(expected);
    } finally {
      root.kill();
    }
  });

  it.each([2.1, 5.3, 12.7])("keeps ambient motion inside an infinite timeline at %s", (time) => {
    const { card, label } = stage(1);
    const root = realGsap.timeline({ paused: true });
    const pulse = realGsap.timeline({ repeat: -1, yoyo: true });
    pulse.to(card, { scale: 1.05, duration: 0.8 }).to(card, { scale: 1, duration: 0.8 });
    root.add(pulse, 0).totalTime(time, true);
    Reflect.set(window, "__timelines", { root });
    prepared(label);
    try {
      const sample = readContrastMotion()[0];
      expect(sample && measuredInMotion(sample)).toBe(false);
    } finally {
      root.kill();
    }
  });

  it("does not treat a paused nested timeline as moving", () => {
    const { label } = stage(1);
    const root = realGsap.timeline({ paused: true });
    const scene = realGsap.timeline({});
    scene.to(label, { x: 100, duration: 1 });
    root.add(scene, 0).to({}, { duration: 1 }, 3).totalTime(0.5, true);
    scene.pause();
    Reflect.set(window, "__timelines", { root });
    prepared(label);
    const sample = readContrastMotion()[0];
    expect(sample && measuredInMotion(sample)).toBe(false);
    root.kill();
  });

  it("keeps untargeted partial-opacity text and no-GSAP pages", () => {
    const { card, label } = stage(0.5);
    prepared(label);
    expect(readContrastMotion()).toEqual([null]);
    const root = realGsap.timeline({ paused: true });
    root.to({}, { duration: 1 }).totalTime(0.5, true);
    Reflect.set(window, "__timelines", { root });
    expect(readContrastMotion()).toEqual([null]);
    card.style.opacity = "0.8";
    root.to(label, { x: 10, duration: 1 }, 1).totalTime(3, true);
    const sample = readContrastMotion()[0];
    expect(sample?.opacity).toBeCloseTo(0.4);
    expect(sample && measuredInMotion(sample)).toBe(true);
    root.kill();
  });
});
