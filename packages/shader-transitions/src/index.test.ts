// @vitest-environment jsdom
import { expect, it } from "vitest";
import { olderShaderBuildOnPage } from "@hyperframes/core/runtime/clip-reveal";

it("declares on load that its revealers lift the runtime's hidden mark", async () => {
  (window as Window & { HyperShader?: unknown }).HyperShader = await import("./index.js");
  expect(olderShaderBuildOnPage()).toBe(false);
});
