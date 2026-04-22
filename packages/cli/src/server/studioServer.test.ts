import { describe, expect, it } from "vitest";
import { loadHyperframeRuntimeSource } from "@hyperframes/core";
import { loadRuntimeSourceFallback } from "./runtimeSource.js";

describe("loadRuntimeSourceFallback", () => {
  it("loads runtime source from the published core entrypoint", async () => {
    await expect(loadRuntimeSourceFallback()).resolves.toBe(loadHyperframeRuntimeSource());
  });
});
