// `lambda deploy --video-arch arm64`: push the arm64 video function image to the stack's own ECR
// repository and return its digest-pinned URI for the template's VideoImageUri.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultDeps, fetchPinned, type StageDeps } from "./prebuiltHandler.js";

export type VideoArch = "x86_64" | "arm64";

/** ECR repository names must be lowercase; stack names need not be. */
function videoRepositoryName(stackName: string): string {
  return `${stackName.toLowerCase()}-video`;
}

export interface PushedVideoImage {
  imageUri: string;
  repositoryName: string;
}

export async function pushVideoImage(
  opts: { stackName: string; region: string; inCheckout: boolean },
  deps: StageDeps = defaultDeps,
): Promise<PushedVideoImage> {
  const sdk = await deps.loadAdapter();
  const tarball = await videoImageTarball(sdk, opts.inCheckout, deps);
  if (!sdk.ensureEcrRepository || !sdk.pushImageToEcr) {
    throw new Error(noVideoImageMessage(opts.inCheckout));
  }
  const layoutDir = mkdtempSync(join(tmpdir(), "hf-video-image-"));
  try {
    const untar = spawnSync("tar", ["-xf", tarball, "-C", layoutDir], { stdio: "inherit" });
    if (untar.status !== 0) {
      throw new Error(
        `[lambda deploy] tar could not extract ${tarball} (exit ${untar.status ?? "unknown"})`,
      );
    }
    const repositoryName = videoRepositoryName(opts.stackName);
    const { repositoryUri } = await sdk.ensureEcrRepository({
      region: opts.region,
      repositoryName,
      tags: [{ Key: "hyperframes:stack", Value: opts.stackName }],
    });
    deps.log(`→ Pushing the arm64 video image to ${repositoryUri}`);
    const pushed = await sdk.pushImageToEcr({
      region: opts.region,
      layoutDir,
      repositoryName,
      repositoryUri,
      tag: "video",
      log: deps.log,
    });
    if (pushed.os !== "linux" || pushed.architecture !== "arm64") {
      throw new Error(
        `[lambda deploy] ${tarball} is a ${pushed.os}/${pushed.architecture} image; the video function needs linux/arm64.`,
      );
    }
    return { imageUri: pushed.imageUri, repositoryName };
  } finally {
    rmSync(layoutDir, { recursive: true, force: true });
  }
}

async function videoImageTarball(
  sdk: Awaited<ReturnType<StageDeps["loadAdapter"]>>,
  inCheckout: boolean,
  deps: StageDeps,
): Promise<string> {
  const local = process.env.HYPERFRAMES_LAMBDA_VIDEO_IMAGE;
  if (local) return local;
  // A checkout deploys its own handler build, so the release's image could run different code.
  const pinned = inCheckout ? undefined : sdk.prebuiltVideoImage?.();
  if (!pinned) throw new Error(noVideoImageMessage(inCheckout));
  return fetchPinned(pinned, { fileName: "video-arm64.oci.tar", label: "arm64 video image" }, deps);
}

function noVideoImageMessage(inCheckout: boolean): string {
  return inCheckout
    ? "[lambda deploy] An arm64 deploy from a checkout needs an image built from that checkout: " +
        "build packages/aws-lambda/image's `video` target as an OCI tarball and set HYPERFRAMES_LAMBDA_VIDEO_IMAGE to it, " +
        "or pass --video-arch x86_64."
    : "[lambda deploy] The installed @hyperframes/aws-lambda pins no arm64 video image. " +
        "Install a newer one, or pass --video-arch x86_64.";
}
