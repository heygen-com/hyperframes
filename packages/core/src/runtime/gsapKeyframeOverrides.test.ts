// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyKeyframeOverrides,
  applyOverrideToTweens,
  selectOverrideTweens,
} from "./gsapKeyframeOverrides";

const mk = (start: number, vars: Record<string, unknown>) => {
  const t: any = { vars, startTime: () => start };
  t.invalidate = vi.fn(() => t);
  return t;
};

describe("selectOverrideTweens", () => {
  it("returns all tweens (sorted) when no index", () => {
    const a = mk(2, {}),
      b = mk(0, {}),
      c = mk(1, {});
    expect(selectOverrideTweens([a, b, c], { selector: "#x" })).toEqual([b, c, a]);
  });
  it("picks the nth tween by start order when tweenIndex is set", () => {
    const a = mk(2, {}),
      b = mk(0, {}),
      c = mk(1, {});
    expect(selectOverrideTweens([a, b, c], { selector: "#x", tweenIndex: 2 })).toEqual([a]);
    expect(selectOverrideTweens([a, b, c], { selector: "#x", tweenIndex: 5 })).toEqual([]);
  });
});

describe("applyOverrideToTweens", () => {
  it("merges vars and invalidates the targeted tween", () => {
    const a = mk(0, { x: 0, opacity: 1 });
    const applied = applyOverrideToTweens([a], { selector: "#x", tweenIndex: 0, vars: { x: 99 } });
    expect(applied).toBe(1);
    expect(a.vars).toEqual({ x: 99, opacity: 1 });
    expect(a.invalidate).toHaveBeenCalledOnce();
  });
});

describe("applyKeyframeOverrides", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the sidecar and applies overrides to matching tweens", async () => {
    const target = mk(0, { x: 0 });
    Object.defineProperty(window, "gsap", {
      configurable: true,
      value: { getTweensOf: (sel: string) => (sel === "#product" ? [target] : []) },
    });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      async json() {
        return [{ selector: "#product", tweenIndex: 0, vars: { x: 250 } }];
      },
    }));

    applyKeyframeOverrides();
    for (let i = 0; i < 4; i++) await Promise.resolve();

    expect(target.vars.x).toBe(250);
    expect(target.invalidate).toHaveBeenCalled();
  });

  it("no-ops without gsap", () => {
    Object.defineProperty(window, "gsap", { configurable: true, value: undefined });
    expect(() => applyKeyframeOverrides()).not.toThrow();
  });
});
