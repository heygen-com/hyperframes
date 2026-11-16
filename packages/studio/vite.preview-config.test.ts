import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newPreviewNonce,
  PREVIEW_NONCE_HEADER,
  provesPreviewOwner,
  type PreviewEndpoint,
} from "@hyperframes/core/preview-proof";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { previewConfigPayload } from "./vite.preview-config";

// The request the CLI's challenge arrives as, on a socket accepted at `endpoint`.
const challenge = (nonce: string, { address, port }: PreviewEndpoint) =>
  ({
    headers: { [PREVIEW_NONCE_HEADER]: nonce },
    socket: { localAddress: address, localPort: port },
  }) as never;

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

  it("answers the CLI's challenge with this user's preview token, for its own endpoint", () => {
    const home = mkdtempSync(join(tmpdir(), "hf-vite-proof-"));
    onTestFinished(() => rmSync(home, { recursive: true, force: true }));
    vi.stubEnv("HOME", home);
    vi.stubEnv("LOCALAPPDATA", home);
    onTestFinished(() => vi.unstubAllEnvs());
    const env = {
      HYPERFRAMES_PREVIEW_PROJECT_DIR: "/tmp/video",
      HYPERFRAMES_PREVIEW_PROJECT_NAME: "video",
    };
    const nonce = newPreviewNonce();
    const endpoint = { address: "::1", port: 5190 };
    const answer = previewConfigPayload(env, 1, "dev", challenge(nonce, endpoint))!;

    expect(provesPreviewOwner(nonce, endpoint, answer)).toBe(true);
    expect(provesPreviewOwner(nonce, { ...endpoint, address: "127.0.0.1" }, answer)).toBe(false);
    expect(previewConfigPayload(env, 1, "dev")).not.toHaveProperty("proof");
  });

  it("proves a Studio started by hand is this user's, without claiming a project", () => {
    const home = mkdtempSync(join(tmpdir(), "hf-vite-proof-"));
    onTestFinished(() => rmSync(home, { recursive: true, force: true }));
    vi.stubEnv("HOME", home);
    vi.stubEnv("LOCALAPPDATA", home);
    onTestFinished(() => vi.unstubAllEnvs());
    const nonce = newPreviewNonce();
    const endpoint = { address: "127.0.0.1", port: 5190 };
    const answer = previewConfigPayload({}, 1, "dev", challenge(nonce, endpoint))!;

    expect(answer).not.toHaveProperty("isHyperframes");
    expect(answer).not.toHaveProperty("projectDir");
    expect(provesPreviewOwner(nonce, endpoint, answer)).toBe(true);
  });

  it("does not claim unrelated direct Vite sessions", () => {
    expect(previewConfigPayload({})).toBeNull();
  });
});
