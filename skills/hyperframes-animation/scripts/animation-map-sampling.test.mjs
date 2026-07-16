import assert from "node:assert/strict";
import test from "node:test";
import { sampleTweenBboxes } from "./animation-map-sampling.mjs";

test("samples every tween time in one browser evaluation", async () => {
  const calls = [];
  const seekTimes = [];
  const originalGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
  };
  let currentTime = 0;
  globalThis.window = { __hf: { seek: (time) => (currentTime = time) } };
  globalThis.document = {
    querySelector: () => ({
      getBoundingClientRect: () => ({ x: currentTime, y: 20, width: 30, height: 40 }),
    }),
  };
  globalThis.getComputedStyle = () => ({ opacity: "1", visibility: "visible", display: "block" });
  const page = {
    async evaluate(callback, payload) {
      calls.push(payload);
      const originalSeek = globalThis.window.__hf.seek;
      globalThis.window.__hf.seek = (time) => {
        seekTimes.push(time);
        originalSeek(time);
      };
      return callback(payload);
    },
  };

  try {
    const result = await sampleTweenBboxes(page, "#card", [1, 2, 3]);

    assert.deepEqual(result, [
      { t: 1, x: 1, y: 20, w: 30, h: 40, opacity: 1, visible: true },
      { t: 2, x: 2, y: 20, w: 30, h: 40, opacity: 1, visible: true },
      { t: 3, x: 3, y: 20, w: 30, h: 40, opacity: 1, visible: true },
    ]);
    assert.deepEqual(seekTimes, [1, 2, 3]);
    assert.deepEqual(calls, [{ selector: "#card", times: [1, 2, 3] }]);
  } finally {
    globalThis.window = originalGlobals.window;
    globalThis.document = originalGlobals.document;
    globalThis.getComputedStyle = originalGlobals.getComputedStyle;
  }
});
