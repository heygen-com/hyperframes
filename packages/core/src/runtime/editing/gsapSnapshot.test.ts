import { afterEach, describe, expect, it } from "vitest";
import { gsap as realGsap } from "gsap";
import { handleFor } from "../editingHandles";
import { gsapSnapshot } from "./gsapSnapshot";
import { MAX_SNAPSHOT_TEXT, MAX_SNAPSHOT_TWEENS } from "./gsapSnapshotLimits";

afterEach(() => {
  document.body.innerHTML = "";
  for (const name of ["gsap", "__timelines", "__player"]) Reflect.deleteProperty(window, name);
});

function frame(tweens: unknown[], getProperty = (_el: Element, prop: string) => prop.length) {
  Object.assign(window, {
    gsap: { getProperty, defaults: () => ({ ease: "power1.out" }) },
    __timelines: {
      main: { getChildren: () => tweens, time: () => 2, vars: { defaults: { ease: "none" } } },
      marker: true,
    },
    __player: { getTime: () => 2 },
  });
}

describe("gsapSnapshot", () => {
  it("copies each tween as plain data, with GSAP's parse and its targets' values now", async () => {
    document.body.innerHTML = `<div id="box" class="card big"></div>`;
    const box = document.getElementById("box")!;
    const pt = { p: "x", s: 0, c: 200, _next: { d: { _pt: { p: "scaleX", s: 1, c: 1 } } } };
    frame([
      {
        targets: () => [box, { notAnElement: true }],
        vars: { x: 200, scale: 2, ease: "expo.out", onComplete: () => {}, data: "hold" },
        startTime: () => 1,
        duration: () => 3,
        _initted: true,
        _pt: pt,
      },
    ]);

    const snapshot = await gsapSnapshot();

    expect(snapshot.time).toBe(2);
    expect(snapshot.defaultEase).toBe("power1.out");
    expect(snapshot.timelines).toEqual([
      {
        id: "main",
        time: 2,
        defaultEase: "none",
        tweens: [
          {
            targets: [handleFor(box)],
            vars: { x: 200, scale: 2, ease: "expo.out", data: "hold" },
            start: 1,
            duration: 3,
            from: false,
            initted: true,
            parsed: [
              { p: "x", s: 0, c: 200 },
              { p: "scaleX", s: 1, c: 1 },
            ],
            parts: [],
          },
        ],
      },
    ]);
    const [target] = snapshot.targets;
    expect(target).toMatchObject({ handle: handleFor(box), id: "box", className: "card big" });
    expect(Object.keys(target!.values).sort()).toEqual(["scale", "scaleX", "x", "y"]);
    expect(() => structuredClone(snapshot)).not.toThrow();
  });

  it("refuses rather than cuts a timeline past the bound", async () => {
    const tween = { targets: () => [], vars: {}, startTime: () => 0, duration: () => 1 };
    frame(Array.from({ length: MAX_SNAPSHOT_TWEENS + 1 }, () => tween));
    await expect(gsapSnapshot()).rejects.toThrow(/bound on tweens/);
  });

  it("refuses a tween value past the text bound", async () => {
    const vars = { text: "a".repeat(MAX_SNAPSHOT_TEXT + 1) };
    frame([{ targets: () => [], vars, startTime: () => 0, duration: () => 1 }]);
    await expect(gsapSnapshot()).rejects.toThrow(/bound on text length/);
  });

  // fails without the fix: only values were held to the text bound, not keys, ids, eases or channel names.
  it.each([
    [
      "a vars key",
      () => frame([{ targets: () => [], vars: { ["k".repeat(MAX_SNAPSHOT_TEXT + 1)]: 1 } }]),
    ],
    [
      "an element id",
      () => {
        document.body.innerHTML = `<div id="${"b".repeat(MAX_SNAPSHOT_TEXT + 1)}"></div>`;
        frame([{ targets: () => [document.body.firstElementChild], vars: {} }]);
      },
    ],
    [
      "a timeline id",
      () => {
        frame([]);
        Object.assign(window, {
          __timelines: { ["t".repeat(MAX_SNAPSHOT_TEXT + 1)]: { getChildren: () => [] } },
        });
      },
    ],
    [
      "the default ease",
      () => {
        frame([]);
        Object.assign(window, {
          gsap: { defaults: () => ({ ease: "e".repeat(MAX_SNAPSHOT_TEXT + 1) }) },
        });
      },
    ],
    [
      "a parsed channel name",
      () =>
        frame([{ targets: () => [], _pt: { p: "p".repeat(MAX_SNAPSHOT_TEXT + 1), s: 0, c: 1 } }]),
    ],
  ])("refuses %s past the text bound", async (_name, set) => {
    set();
    await expect(gsapSnapshot()).rejects.toThrow(/bound on text length/);
  });

  // fails without the fix: a property-tween chain that loops back on itself was walked forever.
  it("stops at a property-tween chain that loops back on itself", async () => {
    const first: Record<string, unknown> = {};
    first._next = { _next: first };
    frame([{ targets: () => [], vars: {}, _pt: first }]);

    const snapshot = await gsapSnapshot();

    expect(snapshot.timelines[0]!.tweens[0]!.parsed).toEqual([]);
  });

  // fails without the fix: GSAP's own state on a keyframes tween's vars tripped the nesting bound, so a sealed preview
  // read no GSAP values and Add keyframe at playhead added nothing.
  it("reads a real GSAP keyframes tween", async () => {
    document.body.innerHTML = `<div id="box"></div>`;
    const tl = realGsap.timeline({ paused: true });
    tl.to(
      "#box",
      { keyframes: { "0%": { x: 0, y: 0 }, "100%": { x: 1200, y: 240 } }, duration: 2 },
      0,
    );
    tl.seek(1);
    Object.assign(window, { gsap: realGsap, __timelines: { main: tl } });

    const snapshot = await gsapSnapshot();

    expect(snapshot.timelines[0]!.tweens).toHaveLength(1);
    expect(snapshot.targets[0]!.values.x).toBeCloseTo(600);
  });
});
