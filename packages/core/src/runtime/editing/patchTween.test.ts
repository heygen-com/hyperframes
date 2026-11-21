import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePatchTweens, patchTweens } from "./patchTween";

afterEach(() => {
  document.body.innerHTML = "";
  for (const key of ["__timelines", "__player", "gsap"]) Reflect.deleteProperty(window, key);
});

function frameWithSets(...tweenVars: Array<Record<string, unknown>>) {
  document.body.innerHTML = `<div id="a"></div><div id="b"></div>`;
  const el = (id: string) => document.getElementById(id)!;
  const tweens = tweenVars.map((vars) => ({
    vars,
    targets: () => [el(String(vars.target))],
    duration: () => 0,
    startTime: () => 0,
    invalidate: vi.fn(),
  }));
  const seek = vi.fn();
  Object.assign(window, {
    __timelines: { main: { getChildren: () => tweens, time: () => 2 } },
    __player: { getTime: () => 2, seek },
  });
  return { tweens, seek };
}

describe("patch-tweens in the frame", () => {
  it("patches each element's own set and renders once, after the last", () => {
    const { tweens, seek } = frameWithSets({ target: "a", x: 0 }, { target: "b", x: 0 });

    const reply = patchTweens({
      patches: [
        { selector: "#a", change: { kind: "set", props: { x: 10 } } },
        { selector: "#b", change: { kind: "set", props: { x: 20 } } },
      ],
      seek: true,
    });

    expect(reply).toEqual({ patched: true });
    expect(tweens.map((t) => t.vars.x)).toEqual([10, 20]);
    expect(seek).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("leaves the render to a later write of the same group", () => {
    const { seek } = frameWithSets({ target: "a", x: 0 });

    patchTweens({
      patches: [{ selector: "#a", change: { kind: "set", props: { x: 5 } } }],
      seek: false,
    });

    expect(seek).not.toHaveBeenCalled();
  });

  it("stops at the first patch it cannot place, so the caller reloads", () => {
    const { tweens } = frameWithSets({ target: "a", x: "+=100" }, { target: "b", x: 0 });

    const reply = patchTweens({
      patches: [
        { selector: "#a", change: { kind: "set", props: { x: 10 } } },
        { selector: "#b", change: { kind: "set", props: { x: 20 } } },
      ],
      seek: true,
    });

    expect(reply).toEqual({ patched: false });
    expect(tweens[1]!.vars.x).toBe(0);
  });

  it("renders a patched set even when the batch ends in a base value", () => {
    const { tweens, seek } = frameWithSets({ target: "a", x: 0 });
    Object.assign(window, { gsap: { set: vi.fn() } });

    const reply = patchTweens({
      patches: [
        { selector: "#a", change: { kind: "set", props: { x: 10 } } },
        { selector: "#b", change: { kind: "global-set", props: { rotation: 45 } } },
      ],
      seek: true,
    });

    expect(reply).toEqual({ patched: true });
    expect(tweens[0]!.vars.x).toBe(10);
    expect(seek).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("applies a base value with the frame's own GSAP", () => {
    frameWithSets();
    const set = vi.fn();
    Object.assign(window, { gsap: { set } });

    const reply = patchTweens({
      patches: [{ selector: "#b", change: { kind: "global-set", props: { rotation: 45 } } }],
      seek: true,
    });

    expect(reply).toEqual({ patched: true });
    expect(set).toHaveBeenCalledExactlyOnceWith(document.getElementById("b"), { rotation: 45 });
  });
});

describe("patch-tweens parser", () => {
  const ok = (change: unknown) =>
    parsePatchTweens({ patches: [{ selector: "#a", change }], seek: true });

  it("takes every change kind Studio sends, with finite values on known channels", () => {
    expect(ok({ kind: "set", props: { x: 1, opacity: 0.5 } })).not.toBeNull();
    expect(ok({ kind: "global-set", props: { width: 120 } })).not.toBeNull();
    expect(ok({ kind: "keyframes", keyframes: [{ x: 0 }, { x: 10 }] })).not.toBeNull();
    expect(ok({ kind: "keyframe-rebuild", pct: 50, props: { y: 3 } })).not.toBeNull();
  });

  it("refuses unknown channels, non-finite values, bad steps and extra fields", () => {
    for (const change of [
      { kind: "set", props: { onUpdate: 1 } },
      { kind: "set", props: { x: Number.POSITIVE_INFINITY } },
      { kind: "set", props: {} },
      { kind: "keyframes", keyframes: [] },
      { kind: "keyframes", keyframes: [{ x: "1" }] },
      { kind: "keyframe-rebuild", pct: 140, props: { y: 3 } },
      { kind: "set", props: { x: 1 }, extra: true },
      { kind: "run", props: { x: 1 } },
      { kind: "toString", props: { x: 1 } },
      { kind: "__proto__", props: { x: 1 } },
      { kind: "constructor", props: { x: 1 } },
    ])
      expect(ok(change)).toBeNull();
    expect(parsePatchTweens({ patches: [], seek: true })).toBeNull();
    expect(
      parsePatchTweens({
        patches: [{ selector: "", change: { kind: "set", props: { x: 1 } } }],
        seek: true,
      }),
    ).toBeNull();
    const many = Array.from({ length: 65 }, () => ({
      selector: "#a",
      change: { kind: "set", props: { x: 1 } },
    }));
    expect(parsePatchTweens({ patches: many, seek: true })).toBeNull();
  });
});
