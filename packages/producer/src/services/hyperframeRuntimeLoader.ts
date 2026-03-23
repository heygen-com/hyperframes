import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCER_DIR = dirname(fileURLToPath(import.meta.url));
const MODULE_RELATIVE_MANIFEST_PATH = resolve(
  PRODUCER_DIR,
  "../../../core/dist/hyperframe.manifest.json",
);
const CWD_RELATIVE_MANIFEST_PATHS = [
  resolve(process.cwd(), "../core/dist/hyperframe.manifest.json"),
  resolve(process.cwd(), "core/dist/hyperframe.manifest.json"),
];

type HyperframeRuntimeManifest = {
  sha256?: string;
  artifacts?: {
    iife?: string;
  };
};

export type ResolvedHyperframeRuntime = {
  manifestPath: string;
  runtimePath: string;
  expectedSha256: string;
  actualSha256: string;
  runtimeSource: string;
};

export function resolveHyperframeManifestPath(): string {
  if (process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH) {
    return process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;
  }
  const candidates = [...CWD_RELATIVE_MANIFEST_PATHS, MODULE_RELATIVE_MANIFEST_PATH];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return MODULE_RELATIVE_MANIFEST_PATH;
}

export function getVerifiedHyperframeRuntimeSource(): string {
  return resolveVerifiedHyperframeRuntime().runtimeSource;
}

export function resolveVerifiedHyperframeRuntime(): ResolvedHyperframeRuntime {
  const manifestPath = resolveHyperframeManifestPath();
  if (!existsSync(manifestPath)) {
    throw new Error(
      `[HyperframeRuntimeLoader] Missing manifest at ${manifestPath}. Build core runtime artifacts before rendering.`,
    );
  }

  const manifestRaw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as HyperframeRuntimeManifest;
  const runtimeFileName = manifest.artifacts?.iife;
  if (!runtimeFileName || !manifest.sha256) {
    throw new Error(
      `[HyperframeRuntimeLoader] Invalid manifest at ${manifestPath}; missing iife artifact or sha256.`,
    );
  }

  const runtimePath = resolve(dirname(manifestPath), runtimeFileName);
  if (!existsSync(runtimePath)) {
    throw new Error(`[HyperframeRuntimeLoader] Missing runtime artifact at ${runtimePath}.`);
  }

  const runtimeSource = readFileSync(runtimePath, "utf8");
  const runtimeSha = createHash("sha256").update(runtimeSource, "utf8").digest("hex");
  if (runtimeSha !== manifest.sha256) {
    throw new Error(
      `[HyperframeRuntimeLoader] Runtime checksum mismatch. expected=${manifest.sha256} actual=${runtimeSha}`,
    );
  }
  return {
    manifestPath,
    runtimePath,
    expectedSha256: manifest.sha256,
    actualSha256: runtimeSha,
    runtimeSource,
  };
}
