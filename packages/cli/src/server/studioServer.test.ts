import { describe, expect, it } from "vitest";
import { loadHyperframeRuntimeSource } from "@hyperframes/core";
import { loadRuntimeSource } from "./runtimeSource.js";

describe("loadRuntimeSource", () => {
  it("loads runtime source from the published core entrypoint", async () => {
    await expect(loadRuntimeSource()).resolves.toBe(loadHyperframeRuntimeSource());
  });
});
