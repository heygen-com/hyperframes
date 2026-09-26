// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readLiveAnimationEnd } from "./timelineEditingGsap";

describe("readLiveAnimationEnd", () => {
  function iframeWithHf(hf: unknown): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    (iframe.contentWindow as unknown as { __hf: unknown }).__hf = hf;
    return iframe;
  }

  it("returns the runtime's animation end", () => {
    expect(readLiveAnimationEnd(iframeWithHf({ animationEnd: () => 5.5 }))).toBe(5.5);
  });

  it.each([
    ["no __hf", undefined],
    ["no animationEnd", {}],
    ["null", { animationEnd: () => null }],
    ["NaN", { animationEnd: () => Number.NaN }],
    ["Infinity", { animationEnd: () => Number.POSITIVE_INFINITY }],
    ["zero", { animationEnd: () => 0 }],
    [
      "a throw",
      {
        animationEnd: () => {
          throw new Error("boom");
        },
      },
    ],
  ])("returns 0 for %s", (_label, hf) => {
    expect(readLiveAnimationEnd(iframeWithHf(hf))).toBe(0);
  });

  it("returns 0 without an iframe", () => {
    expect(readLiveAnimationEnd(null)).toBe(0);
  });
});
