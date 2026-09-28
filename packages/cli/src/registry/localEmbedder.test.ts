import { describe, expect, it, vi } from "vitest";

const installs = vi.hoisted(() => ({ count: 0 }));

vi.mock("../utils/optionalPackages.js", () => ({
  installedOptionalPackageVersion: () => null,
  loadInstalledOptionalPackage: () => null,
  loadOptionalPackage: async () => {
    installs.count += 1;
    return {};
  },
}));

import { hasLocalRuntime, loadLocalEmbedder } from "./localEmbedder.js";

describe("loadLocalEmbedder", () => {
  it("never installs the runtime; a search without it falls back instead", async () => {
    await expect(loadLocalEmbedder()).rejects.toThrow("not installed");
    expect(installs.count).toBe(0);
    expect(hasLocalRuntime()).toBe(false);
  });
});
