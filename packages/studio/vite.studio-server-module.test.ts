import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadStudioServerDevModule } from "./vite.studio-server-module";

describe("loadStudioServerDevModule", () => {
  it("passes the workspace server source entry to Vite instead of the package node export", async () => {
    const ssrLoadModule = vi.fn().mockResolvedValue({ createStudioApi: vi.fn() });
    const studioDir = resolve("repo/packages/studio");

    await loadStudioServerDevModule({ ssrLoadModule }, studioDir);

    expect(ssrLoadModule).toHaveBeenCalledWith(resolve(studioDir, "../studio-server/src/index.ts"));
  });
});
