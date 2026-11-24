// @vitest-environment happy-dom
import gsap from "gsap";
import { describe, expect, it, vi } from "vitest";
import { muteDiscreteCallbacks } from "./gsap";
import type { RuntimeTimelineLike } from "../types";

const asRuntime = (tl: gsap.core.Timeline): RuntimeTimelineLike =>
  tl as unknown as RuntimeTimelineLike;

function sweep(tl: gsap.core.Timeline, ...times: number[]): void {
  for (const t of times) tl.seek(t, false);
}

describe("muteDiscreteCallbacks", () => {
  it("quiets onStart, onComplete, onReverseComplete and onRepeat, and leaves onUpdate firing", () => {
    const fired = { start: 0, complete: 0, reverse: 0, repeat: 0, update: 0 };
    const tl = gsap.timeline({ paused: true });
    tl.to(
      { v: 0 },
      {
        v: 1,
        duration: 0.2,
        repeat: 1,
        onStart: () => void fired.start++,
        onComplete: () => void fired.complete++,
        onReverseComplete: () => void fired.reverse++,
        onRepeat: () => void fired.repeat++,
        onUpdate: () => void fired.update++,
      },
      0.1,
    );

    const restore = muteDiscreteCallbacks([asRuntime(tl)]);
    sweep(tl, 0, 0.2, 0.6, 0);
    expect(fired.start + fired.complete + fired.reverse + fired.repeat).toBe(0);
    expect(fired.update).toBeGreaterThan(0);

    restore();
    sweep(tl, 0.2, 0.6, 0);
    expect(fired.start).toBeGreaterThan(0);
    expect(fired.complete).toBeGreaterThan(0);
    expect(fired.reverse).toBeGreaterThan(0);
    expect(fired.repeat).toBeGreaterThan(0);
  });

  it("reaches a stagger's and a keyframes tween's own tweens", () => {
    const staggered = vi.fn();
    const keyed = vi.fn();
    const tl = gsap.timeline({ paused: true });
    tl.to(
      [{ v: 0 }, { v: 0 }],
      {
        v: 1,
        duration: 0.05,
        stagger: { each: 0.05, onComplete: staggered },
      },
      0.1,
    );
    tl.to(
      { v: 0 },
      {
        keyframes: [
          { v: 0.5, duration: 0.05 },
          { v: 1, duration: 0.05, onComplete: keyed },
        ],
      },
      0.4,
    );

    const restore = muteDiscreteCallbacks([asRuntime(tl)]);
    sweep(tl, 0, 1);
    expect(staggered).not.toHaveBeenCalled();
    expect(keyed).not.toHaveBeenCalled();

    restore();
    sweep(tl, 0, 1);
    expect(staggered).toHaveBeenCalled();
    expect(keyed).toHaveBeenCalled();
  });

  it("restores a callback reached through two timelines", () => {
    const fn = vi.fn();
    const root = gsap.timeline({ paused: true });
    const scene = gsap.timeline();
    scene.call(fn, [], 0.5);
    root.add(scene, 0);

    const restore = muteDiscreteCallbacks([asRuntime(scene), asRuntime(root)]);
    sweep(root, 0, 1);
    expect(fn).not.toHaveBeenCalled();

    restore();
    sweep(root, 0, 1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("restores the outer mute's callbacks when mutes nest", () => {
    const fn = vi.fn();
    const tl = gsap.timeline({ paused: true });
    tl.call(fn, [], 0.5);

    const outer = muteDiscreteCallbacks([asRuntime(tl)]);
    const inner = muteDiscreteCallbacks([asRuntime(tl)]);
    inner();
    sweep(tl, 0, 1);
    expect(fn).not.toHaveBeenCalled();

    outer();
    sweep(tl, 0, 1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps a replaced function's params and scope", () => {
    const scope = { name: "scope" };
    const seen: Array<{ args: unknown[]; scope: unknown }> = [];
    const fn = function (this: unknown, ...args: unknown[]): void {
      seen.push({ args, scope: this });
    };
    const tl = gsap.timeline({ paused: true });
    tl.call(fn, ["x"], 0.5);
    const call = tl.getChildren(false, true, false)[0] as gsap.core.Tween;
    call.vars.callbackScope = scope;

    const restore = muteDiscreteCallbacks([asRuntime(tl)]);
    sweep(tl, 0, 1);
    expect(seen).toEqual([]);

    restore();
    sweep(tl, 0, 1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.args).toEqual(["x"]);
    expect(seen[0]?.scope).toBe(scope);
  });
});
