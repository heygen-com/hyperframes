import { describe, expect, it } from "vitest";
import { previewConfigPayload } from "./vite.preview-config";

describe("previewConfigPayload", () => {
  it("identifies a detached Vite preview to the CLI lifecycle scanner", () => {
    expect(
      previewConfigPayload(
        {
          HYPERFRAMES_PREVIEW_PROJECT_DIR: "/tmp/video",
          HYPERFRAMES_PREVIEW_PROJECT_NAME: "video",
          HYPERFRAMES_PREVIEW_BROWSER_GPU_MODE: "software",
        },
        4321,
        "0.7.109",
      ),
    ).toEqual({
      isHyperframes: true,
      pid: 4321,
      projectName: "video",
      projectDir: "/tmp/video",
      serverBuildSignature: null,
      browserGpuMode: "software",
      version: "0.7.109",
    });
  });

  it("does not claim unrelated direct Vite sessions", () => {
    expect(previewConfigPayload({})).toBeNull();
  });
});
