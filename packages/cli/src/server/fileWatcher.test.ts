import { describe, expect, it } from "vitest";

import { shouldWatchProjectFile } from "./fileWatcher.js";

describe("shouldWatchProjectFile", () => {
  it("watches files that can affect the project signature", () => {
    expect(shouldWatchProjectFile("index.html")).toBe(true);
    expect(shouldWatchProjectFile("src/scene.tsx")).toBe(true);
    expect(shouldWatchProjectFile("assets/hero.png")).toBe(true);
    expect(shouldWatchProjectFile("Dockerfile")).toBe(true);
  });

  it("skips generated and dependency directories excluded from signatures", () => {
    expect(shouldWatchProjectFile("node_modules/pkg/index.js")).toBe(false);
    expect(shouldWatchProjectFile("renders/output.mp4")).toBe(false);
    expect(shouldWatchProjectFile("dist/index.html")).toBe(false);
    expect(shouldWatchProjectFile(".hyperframes/cache.json")).toBe(false);
  });
});
