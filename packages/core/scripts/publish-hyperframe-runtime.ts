import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

type RuntimeManifest = {
  sha256: string;
  artifacts: {
    iife: string;
    esm: string;
  };
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function runAws(args: string[]): string {
  return execFileSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function uploadFile(params: {
  localPath: string;
  bucket: string;
  key: string;
  cacheControl: string;
  contentType: string;
}): void {
  const { localPath, bucket, key, cacheControl, contentType } = params;
  runAws([
    "s3",
    "cp",
    localPath,
    `s3://${bucket}/${key}`,
    "--cache-control",
    cacheControl,
    "--content-type",
    contentType,
  ]);
}

const thisDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(thisDir, "../dist");
const manifestPath = resolve(distDir, "hyperframe.manifest.json");

if (!existsSync(manifestPath)) {
  throw new Error(`Missing ${manifestPath}. Run: pnpm --filter @hyperframes/core build:hyperframe-runtime`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RuntimeManifest;
const iifePath = resolve(distDir, manifest.artifacts.iife);
const esmPath = resolve(distDir, manifest.artifacts.esm);
if (!existsSync(iifePath) || !existsSync(esmPath)) {
  throw new Error("Runtime artifact(s) missing from core/dist.");
}

const bucket = requireEnv("HYPERFRAME_RUNTIME_S3_BUCKET");
const prefix = (process.env.HYPERFRAME_RUNTIME_S3_PREFIX?.trim() || "static/hyperframes-runtime").replace(
  /^\/+|\/+$/g,
  "",
);
const cloudfrontDistId = process.env.HYPERFRAME_RUNTIME_CLOUDFRONT_DISTRIBUTION_ID?.trim() || "";
const shaShort = manifest.sha256.slice(0, 12);

const iifeKey = `${prefix}/hyperframe.runtime.iife.js`;
const esmKey = `${prefix}/hyperframe.runtime.mjs`;
const manifestKey = `${prefix}/hyperframe.manifest.json`;
const iifeVersionedKey = `${prefix}/hyperframe.runtime.iife.${shaShort}.js`;
const esmVersionedKey = `${prefix}/hyperframe.runtime.${shaShort}.mjs`;

uploadFile({
  localPath: iifePath,
  bucket,
  key: iifeVersionedKey,
  cacheControl: "public,max-age=31536000,immutable",
  contentType: "application/javascript",
});
uploadFile({
  localPath: esmPath,
  bucket,
  key: esmVersionedKey,
  cacheControl: "public,max-age=31536000,immutable",
  contentType: "text/javascript",
});
uploadFile({
  localPath: iifePath,
  bucket,
  key: iifeKey,
  cacheControl: "public,max-age=31536000,immutable",
  contentType: "application/javascript",
});
uploadFile({
  localPath: esmPath,
  bucket,
  key: esmKey,
  cacheControl: "public,max-age=31536000,immutable",
  contentType: "text/javascript",
});
uploadFile({
  localPath: manifestPath,
  bucket,
  key: manifestKey,
  cacheControl: "no-cache,max-age=0,must-revalidate",
  contentType: "application/json",
});

let invalidationId: string | null = null;
if (cloudfrontDistId) {
  const invalidationRaw = runAws([
    "cloudfront",
    "create-invalidation",
    "--distribution-id",
    cloudfrontDistId,
    "--paths",
    `/${iifeKey}`,
    `/${esmKey}`,
    `/${manifestKey}`,
    "--query",
    "Invalidation.Id",
    "--output",
    "text",
  ]);
  invalidationId = invalidationRaw || null;
}

console.log(
  JSON.stringify({
    event: "hyperframe_runtime_published",
    bucket,
    prefix,
    sha256: manifest.sha256,
    artifacts: {
      iife: iifeKey,
      esm: esmKey,
      manifest: manifestKey,
      iifeVersioned: iifeVersionedKey,
      esmVersioned: esmVersionedKey,
    },
    cache: {
      runtime: "public,max-age=31536000,immutable",
      manifest: "no-cache,max-age=0,must-revalidate",
    },
    cloudfrontInvalidationId: invalidationId,
  }),
);
