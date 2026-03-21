import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HYPERFRAME_RUNTIME_ARTIFACTS } from "../src/inline-scripts/hyperframe";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const scriptsDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const distDir = resolve(scriptsDir, "../dist");
const iifePath = resolve(distDir, HYPERFRAME_RUNTIME_ARTIFACTS.iife);
const manifestPath = resolve(distDir, HYPERFRAME_RUNTIME_ARTIFACTS.manifest);

const iifeSource = readFileSync(iifePath, "utf8");
const manifestRaw = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw) as {
  sha256?: string;
  artifacts?: { iife?: string; esm?: string };
};

assert(iifeSource.length > 0, "IIFE runtime artifact is empty");
assert(
  manifest.artifacts?.iife === HYPERFRAME_RUNTIME_ARTIFACTS.iife,
  "Manifest iife artifact name is not strict expected value",
);
assert(
  manifest.artifacts?.esm === HYPERFRAME_RUNTIME_ARTIFACTS.esm,
  "Manifest esm artifact name is not strict expected value",
);
assert(Boolean(manifest.artifacts?.iife), "Manifest missing iife artifact entry");
assert(Boolean(manifest.artifacts?.esm), "Manifest missing esm artifact entry");

const runtimeSha = createHash("sha256").update(iifeSource, "utf8").digest("hex");
assert(runtimeSha === manifest.sha256, "Manifest sha256 does not match runtime artifact");

console.log(
  JSON.stringify({
    event: "hyperframe_runtime_parity_verified",
    bytes: iifeSource.length,
    sha256: runtimeSha,
  }),
);
