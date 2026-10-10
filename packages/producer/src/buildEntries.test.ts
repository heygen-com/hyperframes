import { dirname, basename } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLES, WORKERS } from "../buildEntries.mjs";

describe("published build layout", () => {
  it("emits each worker beside the bundles whose worker lookup probes their own directory", () => {
    const bundleDirs = new Set(BUNDLES.map(({ outfile }) => dirname(outfile)));
    expect([...bundleDirs]).toEqual(["dist"]);
    expect(WORKERS.map(({ outfile }) => dirname(outfile))).toEqual(["dist", "dist"]);
    expect(WORKERS.map(({ outfile }) => basename(outfile)).sort()).toEqual([
      "healthWorkerThread.js",
      "shaderTransitionWorker.js",
    ]);
  });
});
