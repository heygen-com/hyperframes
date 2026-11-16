import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPreviewNonce, provesPreviewOwner } from "@hyperframes/core/preview-proof";
import { describe, expect, it, onTestFinished, vi } from "vitest";
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

  it("answers the CLI's challenge with this user's preview token", () => {
    const cache = mkdtempSync(join(tmpdir(), "hf-vite-proof-"));
    onTestFinished(() => rmSync(cache, { recursive: true, force: true }));
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", cache);
    onTestFinished(() => vi.unstubAllEnvs());
    const env = {
      HYPERFRAMES_PREVIEW_PROJECT_DIR: "/tmp/video",
      HYPERFRAMES_PREVIEW_PROJECT_NAME: "video",
    };
    const nonce = newPreviewNonce();

    expect(provesPreviewOwner(nonce, previewConfigPayload(env, 1, "dev", nonce)?.proof)).toBe(true);
    expect(previewConfigPayload(env, 1, "dev")).not.toHaveProperty("proof");
  });

  it("does not claim unrelated direct Vite sessions", () => {
    expect(previewConfigPayload({})).toBeNull();
  });
});
