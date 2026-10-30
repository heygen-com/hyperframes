import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StageDeps } from "./prebuiltHandler.js";
import { pushVideoImage } from "./videoImage.js";

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-video-image-test-"));
  dirs.push(dir);
  return dir;
}

/** A tarball of a minimal OCI layout, as the release attaches. */
function ociTar(): Buffer {
  const layout = tempDir();
  mkdirSync(join(layout, "blobs", "sha256"), { recursive: true });
  writeFileSync(join(layout, "index.json"), '{"manifests":[]}');
  writeFileSync(join(layout, "oci-layout"), '{"imageLayoutVersion":"1.0.0"}');
  const tar = join(tempDir(), "image.oci.tar");
  expect(spawnSync("tar", ["-cf", tar, "-C", layout, "."]).status).toBe(0);
  return readFileSync(tar);
}

function setup(opts: { architecture?: string } = {}) {
  const tar = ociTar();
  const sha256 = createHash("sha256").update(tar).digest("hex");
  const pushedLayouts: string[] = [];
  const pushed: Record<string, unknown>[] = [];
  const sdk = {
    prebuiltVideoImage: vi.fn(() => ({
      version: "9.8.7",
      url: "https://x/v.tar",
      sha256,
      bytes: tar.length,
    })),
    ensureEcrRepository: vi.fn(async ({ repositoryName }: { repositoryName: string }) => ({
      repositoryUri: `1.dkr.ecr.r.amazonaws.com/${repositoryName}`,
    })),
    pushImageToEcr: vi.fn(async (o: { layoutDir: string; repositoryUri: string }) => {
      pushedLayouts.push(readFileSync(join(o.layoutDir, "index.json"), "utf-8"));
      pushed.push(o);
      return {
        imageUri: `${o.repositoryUri}@sha256:abc`,
        digest: "sha256:abc",
        architecture: opts.architecture ?? "arm64",
        os: "linux",
      };
    }),
  };
  const deps: StageDeps = {
    loadAdapter: async () => sdk as never,
    download: async (_url, dest) => writeFileSync(dest, tar),
    cacheDir: join(tempDir(), "cache"),
    log: () => {},
  };
  return { sdk, deps, tar, pushedLayouts, pushed };
}

describe("pushVideoImage", () => {
  it("outside a checkout, pushes the pinned image to the stack's repository and returns its digest URI", async () => {
    const { deps, sdk, pushedLayouts, pushed } = setup();
    const result = await pushVideoImage(
      { stackName: "My-Stack", region: "r", inCheckout: false },
      deps,
    );
    expect(result).toEqual({
      imageUri: "1.dkr.ecr.r.amazonaws.com/my-stack-video@sha256:abc",
      repositoryName: "my-stack-video",
    });
    expect(pushedLayouts).toEqual(['{"manifests":[]}']);
    // destroy deletes this repository, so it is only ever one this stack created and tagged.
    expect(sdk.ensureEcrRepository).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [{ Key: "hyperframes:stack", Value: "My-Stack" }] }),
    );
    expect(existsSync(pushed[0]?.layoutDir as string)).toBe(false);
  });

  it("refuses an image that is not linux/arm64", async () => {
    const { deps } = setup({ architecture: "amd64" });
    await expect(
      pushVideoImage({ stackName: "s", region: "r", inCheckout: false }, deps),
    ).rejects.toThrow("is a linux/amd64 image; the video function needs linux/arm64");
  });

  it("in a checkout, refuses the release image, whose handler code may differ", async () => {
    const { deps, sdk } = setup();
    await expect(
      pushVideoImage({ stackName: "s", region: "r", inCheckout: true }, deps),
    ).rejects.toThrow(/set HYPERFRAMES_LAMBDA_VIDEO_IMAGE[\s\S]*--video-arch x86_64/);
    expect(sdk.pushImageToEcr).not.toHaveBeenCalled();
  });

  it("outside a checkout, an adapter that pins no image names --video-arch x86_64", async () => {
    const { deps, sdk } = setup();
    sdk.prebuiltVideoImage.mockReturnValue(undefined as never);
    await expect(
      pushVideoImage({ stackName: "s", region: "r", inCheckout: false }, deps),
    ).rejects.toThrow(/pins no arm64 video image[\s\S]*--video-arch x86_64/);
    expect(sdk.pushImageToEcr).not.toHaveBeenCalled();
  });

  it("pushes a local image from HYPERFRAMES_LAMBDA_VIDEO_IMAGE instead of the pinned one", async () => {
    const { deps, sdk, tar, pushedLayouts } = setup();
    const local = join(tempDir(), "local.oci.tar");
    writeFileSync(local, tar);
    vi.stubEnv("HYPERFRAMES_LAMBDA_VIDEO_IMAGE", local);
    await pushVideoImage({ stackName: "s", region: "r", inCheckout: true }, deps);
    expect(sdk.prebuiltVideoImage).not.toHaveBeenCalled();
    expect(pushedLayouts).toHaveLength(1);
  });
});
