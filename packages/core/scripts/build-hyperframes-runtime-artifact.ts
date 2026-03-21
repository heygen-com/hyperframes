import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import {
  HYPERFRAME_RUNTIME_ARTIFACTS,
  HYPERFRAME_RUNTIME_CONTRACT,
  loadHyperframeRuntimeSource,
} from "../src/inline-scripts/hyperframe";

const thisDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(thisDir, "../dist");
const iifePath = resolve(distDir, HYPERFRAME_RUNTIME_ARTIFACTS.iife);
const esmPath = resolve(distDir, HYPERFRAME_RUNTIME_ARTIFACTS.esm);
const manifestPath = resolve(distDir, HYPERFRAME_RUNTIME_ARTIFACTS.manifest);

const runtimeSource = `${loadHyperframeRuntimeSource()}\n`;
const runtimeSha256 = createHash("sha256").update(runtimeSource, "utf8").digest("hex");
const buildId = process.env.HYPERFRAME_RUNTIME_BUILD_ID?.trim() || "dev";
const runtimeEntryPath = resolve(thisDir, "../src/runtime/entry.ts");
const esmBuild = buildSync({
  entryPoints: [runtimeEntryPath],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  target: ["es2020"],
  minify: true,
  legalComments: "none",
});
const esmSource = `${esmBuild.outputFiles[0]?.text ?? ""}\n`;

const manifest = {
  version: process.env.HYPERFRAME_RUNTIME_VERSION?.trim() || "0.1.0",
  buildId,
  sha256: runtimeSha256,
  artifacts: {
    iife: HYPERFRAME_RUNTIME_ARTIFACTS.iife,
    esm: HYPERFRAME_RUNTIME_ARTIFACTS.esm,
  },
  contract: HYPERFRAME_RUNTIME_CONTRACT,
};

mkdirSync(distDir, { recursive: true });
writeFileSync(iifePath, runtimeSource, "utf8");
writeFileSync(esmPath, esmSource, "utf8");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify({
    event: "hyperframe_runtime_artifacts_generated",
    buildId,
    distDir,
    iifePath,
    esmPath,
    manifestPath,
    sourceBytes: Buffer.byteLength(runtimeSource, "utf8"),
    esmBytes: Buffer.byteLength(esmSource, "utf8"),
    sha256: runtimeSha256,
  }),
);
