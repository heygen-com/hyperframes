// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { readBasePosition } from "./useGestureRecording";

describe("readBasePosition", () => {
  it("preserves zero opacity and scale from the GSAP runtime", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const element = document.createElement("div");
    const values: Record<string, number> = {
      opacity: 0,
      scaleX: 0,
      x: 0,
      y: 0,
    };
    Object.assign(iframe.contentWindow!, {
      gsap: {
        getProperty: (_element: Element, property: string) => values[property],
      },
    });

    expect(readBasePosition(element, iframe)).toMatchObject({
      baseOpacity: 0,
      baseScale: 0,
      baseX: 0,
      baseY: 0,
    });
  });

  it("falls back only for non-finite GSAP values", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const element = document.createElement("div");
    Object.assign(iframe.contentWindow!, {
      gsap: {
        getProperty: (_element: Element, property: string) =>
          property === "opacity" ? Number.NaN : Number.POSITIVE_INFINITY,
      },
    });

    expect(readBasePosition(element, iframe)).toMatchObject({
      baseOpacity: 1,
      baseScale: 1,
      baseX: 0,
      baseY: 0,
    });
  });
});
