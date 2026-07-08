import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  getVerifiedHyperframeRuntimeSource,
  resolveHyperframeManifestPath,
} from "./services/hyperframeRuntimeLoader.js";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const manifestPath = resolveHyperframeManifestPath();
const manifestRaw = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw) as {
  sha256?: string;
  artifacts?: { iife?: string };
};

const verifiedSource = getVerifiedHyperframeRuntimeSource();
const sourceSha = createHash("sha256").update(verifiedSource, "utf8").digest("hex");
assert(sourceSha === manifest.sha256, "Verified runtime hash does not match manifest sha256");

const servicesDir = resolve(dirname(fileURLToPath(import.meta.url)), "services");
const fileServerSource = readFileSync(resolve(servicesDir, "fileServer.ts"), "utf8");
assert(
  fileServerSource.includes("getVerifiedHyperframeRuntimeSource"),
  "Producer file server must inject runtime via getVerifiedHyperframeRuntimeSource",
);
assert(
  !fileServerSource.includes("loadHyperframeRuntimeSource"),
  "Producer file server must not inject runtime via loadHyperframeRuntimeSource",
);

console.log(
  JSON.stringify({
    event: "producer_runtime_manifest_conformance_ok",
    manifestPath,
    runtimeSha256: sourceSha,
  }),
);

if (!process.argv.includes("--manifest-only")) {
  const { runAnimeJsDeterminismGate } = await import("./animejs-determinism-gate.js");
  await runAnimeJsDeterminismGate();
}
