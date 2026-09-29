// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "./Timeline";
import { installTimelineMountEnv } from "./timelineMountTestEnv";
import { usePlayerStore } from "../store/playerStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installTimelineMountEnv();

afterEach(() => {
  document.body.innerHTML = "";
});

async function diamondCount(showKeyframes?: boolean) {
  usePlayerStore.setState({
    duration: 10,
    currentTime: 0,
    timelineReady: true,
    elements: [{ id: "card", tag: "div", start: 0, duration: 4, track: 0 }],
    keyframeCache: new Map([
      [
        "card",
        {
          format: "gsap",
          keyframes: [
            { percentage: 0, properties: { x: 0 } },
            { percentage: 50, properties: { x: 100 } },
          ],
        },
      ],
    ]),
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Timeline showKeyframes={showKeyframes} />));
  const count = host.querySelectorAll("[data-keyframe-percentage]").length;
  act(() => root.unmount());
  return count;
}

describe("Timeline showKeyframes", () => {
  it("draws a keyframed clip's diamonds by default", async () => {
    expect(await diamondCount()).toBeGreaterThan(0);
  });

  it("draws no keyframe diamonds when the host turns keyframes off", async () => {
    expect(await diamondCount(false)).toBe(0);
  });
});
