import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dockerfile = readFileSync(join(root, "packages/gcp-cloud-run/Dockerfile"), "utf8");
const copiedManifests = new Set(
  [...dockerfile.matchAll(/COPY packages\/([^/]+)\/package\.json/g)].map((match) => match[1]),
);
const copiedSources = new Set(
  [...dockerfile.matchAll(/COPY packages\/([^/]+)\/ packages\/\1\//g)].map((match) => match[1]),
);
const workspacePackages = readdirSync(join(root, "packages")).filter((name) => {
  try {
    return statSync(join(root, "packages", name, "package.json")).isFile();
  } catch {
    return false;
  }
});
const missing = workspacePackages.filter((name) => !copiedManifests.has(name));
if (missing.length > 0) {
  throw new Error(`GCP Cloud Run Dockerfile is missing workspace manifests: ${missing.join(", ")}`);
}
const requiredSourcePackages = [
  "core",
  "engine",
  "gcp-cloud-run",
  "lint",
  "parsers",
  "producer",
  "sdk",
  "sdk-playground",
  "studio-server",
];
const missingSources = requiredSourcePackages.filter((name) => !copiedSources.has(name));
if (missingSources.length > 0) {
  throw new Error(
    `GCP Cloud Run Dockerfile is missing workspace sources: ${missingSources.join(", ")}`,
  );
}
console.log(
  `GCP Cloud Run Dockerfile covers ${workspacePackages.length} workspace manifests and sources.`,
);
