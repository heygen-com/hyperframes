import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("./colorGrading", async (original) => {
  const real = await original<typeof import("./colorGrading")>();
  return {
    ...real,
    createColorGradingRuntime: (...args: Parameters<typeof real.createColorGradingRuntime>) => {
      const api = real.createColorGradingRuntime(...args);
      return {
        ...api,
        holdSeekUntilDrawn: () => void calls.push("hold"),
        redraw: () => {
          calls.push("redraw");
          return api.redraw();
        },
      };
    },
  };
});

afterEach(() => {
  calls.length = 0;
  vi.restoreAllMocks();
});

it("a paused seek holds for the graded videos' draw before it redraws them", () => {
  resetRuntimeFixtureDom();
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="60"><div id="clip" data-start="0" data-duration="60"></div></div>';
  window.__timelines = { main: createMockTimeline(60) };
  initSandboxRuntimeModular();
  calls.length = 0;

  window.__player!.seek(5);

  expect(calls.slice(0, 2)).toEqual(["hold", "redraw"]);
});
