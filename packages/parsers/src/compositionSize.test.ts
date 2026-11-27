import { describe, expect, it } from "vitest";
import { renderedCompositionSize } from "./compositionSize.js";

const root = (attrs: string) => `<div data-composition-id="main" ${attrs}></div>`;

describe("renderedCompositionSize", () => {
  it("reads the root's declared size", () => {
    expect(renderedCompositionSize(root('data-width="1920" data-height="1080"'))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("is portrait 1080×1920 for a root that declares no size, or no root at all", () => {
    expect(renderedCompositionSize(root(""))).toEqual({ width: 1080, height: 1920 });
    expect(renderedCompositionSize("<div></div>")).toEqual({ width: 1080, height: 1920 });
  });

  it("defaults each side on its own", () => {
    expect(renderedCompositionSize(root('data-width="1920"'))).toEqual({
      width: 1920,
      height: 1920,
    });
  });

  it("skips a scene kept in a <template> ahead of the root", () => {
    const scene = `<template><div data-composition-id="intro" data-width="1920" data-height="1080"></div></template>`;
    expect(renderedCompositionSize(scene + root('data-width="1080" data-height="1350"'))).toEqual({
      width: 1080,
      height: 1350,
    });
  });
});
