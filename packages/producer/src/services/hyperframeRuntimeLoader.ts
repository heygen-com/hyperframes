import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCER_DIR = dirname(fileURLToPath(import.meta.url));
const SIBLING_MANIFEST_PATH = resolve(PRODUCER_DIR, "hyperframe.manifest.json");
const MODULE_RELATIVE_MANIFEST_PATH = resolve(
  PRODUCER_DIR,
  "../../../core/dist/hyperframe.manifest.json",
);
// Order matters: a bundled CLI ships the manifest as a sibling of the
// packaged module; dev runs reach it via monorepo-relative paths. Listed
// once here so the resolver and the missing-manifest error share the same
// owner — printing only the fallback candidate misdirects the user
// (heygen-com/hyperframes#3370).
const MANIFEST_CANDIDATES: readonly string[] = [
  SIBLING_MANIFEST_PATH,
  resolve(process.cwd(), "packages/core/dist/hyperframe.manifest.json"),
  resolve(process.cwd(), "../core/dist/hyperframe.manifest.json"),
  resolve(process.cwd(), "core/dist/hyperframe.manifest.json"),
  MODULE_RELATIVE_MANIFEST_PATH,
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
  const envOverride = process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;
  if (envOverride) {
    return envOverride;
  }
  const found = MANIFEST_CANDIDATES.find((candidate) => existsSync(candidate));
  // Fall back to the last candidate only when nothing exists. The caller will
  // read its iife/artifact and throw; returning a stable but unreachable path
  // keeps the existing API contract.
  return found ?? MODULE_RELATIVE_MANIFEST_PATH;
}

export function triedManifestPaths(): readonly string[] {
  return process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH
    ? [process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH]
    : MANIFEST_CANDIDATES;
}

export function getVerifiedHyperframeRuntimeSource(): string {
  return resolveVerifiedHyperframeRuntime().runtimeSource;
}

export function resolveVerifiedHyperframeRuntime(): ResolvedHyperframeRuntime {
  const manifestPath = resolveHyperframeManifestPath();
  if (!existsSync(manifestPath)) {
    const tried = triedManifestPaths().join(", ");
    throw new Error(
      `[HyperframeRuntimeLoader] Missing manifest. Tried: ${tried}. Searched from cwd=${process.cwd()}. Build core runtime artifacts before rendering.`,
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
