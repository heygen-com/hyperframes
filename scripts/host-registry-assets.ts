#!/usr/bin/env tsx
/**
 * Move a registry item's binary assets onto the public CDN.
 *
 * A registry item is served straight out of this repository
 * (`DEFAULT_REGISTRY_URL` points at raw.githubusercontent.com), so every byte a
 * block ships is a byte in the history forever. Compositions are text and cost
 * nothing; images are not. One carousel family arrived with 396 JPEGs.
 *
 * This rewrites those files as `url` entries in the manifest and takes the
 * bytes out of the tree. `path` is untouched — it still says where the file
 * lands relative to the item, so the composition HTML, the installer's target
 * mirroring and the catalog preview renderer all keep working unchanged.
 *
 * Keys are content-addressed: the same image referenced by twenty-five blocks
 * uploads once and every manifest points at the same URL. It also means a
 * changed image gets a new key, which is the only safe way to publish behind
 * `immutable, max-age=31536000` — a re-upload under the old name would keep
 * serving the old bytes at the edge until the TTL expired.
 *
 * Usage:
 *   bun run scripts/host-registry-assets.ts --all
 *   bun run scripts/host-registry-assets.ts carousel-orbit-1 carousel-orbit-2
 *   bun run scripts/host-registry-assets.ts --all --dry-run
 *   bun run scripts/host-registry-assets.ts --all --no-upload   # stage only
 *
 * Requires AWS credentials for the heygen engineering account
 * (profile: engineering-767398024897) with s3:PutObject, unless --no-upload.
 * Contributors without AWS access: open the PR with the assets committed and a
 * maintainer will run this before merging.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAsCommand } from "./entrypoint.ts";
// Import from source, like every other script here: bun workspace linking does
// not resolve for scripts outside packages/.
import { ITEM_TYPE_DIRS, type FileTarget, type RegistryItem } from "../packages/core/src/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CDN_BASE = "https://static.heygen.ai/hyperframes-oss/registry-assets";
const S3_DEST = "s3://heygen-public/hyperframes-oss/registry-assets";
const PROFILE = process.env.AWS_PROFILE ?? "engineering-767398024897";
const STAGING_DIR = resolve(repoRoot, ".registry-assets-staging");

/**
 * Extensions worth hosting. Text files stay in the repository: they diff, they
 * review, and they cost a few hundred bytes. Only the opaque blobs leave.
 */
const HOSTED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".m4a",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".glb",
  ".gltf",
]);

interface Plan {
  /** Absolute path of the file to remove from the tree. */
  source: string;
  /** Content-addressed object key, without the bucket prefix. */
  key: string;
  /** Public URL the manifest will carry. */
  url: string;
}

function itemDirsUnder(typeDir: string): string[] {
  const root = join(repoRoot, "registry", typeDir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((dir) => existsSync(join(dir, "registry-item.json")));
}

/** Every item directory under registry/ that has a manifest. */
function allItemDirs(): string[] {
  const typeDirs = [...new Set(Object.values(ITEM_TYPE_DIRS))];
  return typeDirs.flatMap(itemDirsUnder).sort();
}

function itemDirFor(name: string): string {
  const match = allItemDirs().find((dir) => dir.endsWith(`/${name}`));
  if (match === undefined) throw new Error(`No registry item named "${name}".`);
  return match;
}

/**
 * A file that already carries `url` is left exactly as it is: its bytes are
 * gone from the tree, so re-deriving a key from a file that is not there would
 * either crash or, worse, silently drop the entry.
 */
function needsHosting(file: FileTarget): boolean {
  return file.url === undefined && HOSTED_EXTENSIONS.has(extname(file.path).toLowerCase());
}

/** Point one file at the CDN, and say which bytes have to get there. */
function hostFile(itemName: string, itemDir: string, file: FileTarget): Plan {
  const source = resolve(itemDir, file.path);
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`${itemName}: files[] declares "${file.path}", which is not on disk.`);
  }
  const digest = createHash("sha256").update(readFileSync(source)).digest("hex").slice(0, 16);
  const key = `${digest}${extname(file.path).toLowerCase()}`;
  file.url = `${CDN_BASE}/${key}`;
  return { source, key, url: file.url };
}

/** Rewrite one item's manifest, and report which bytes have to reach the CDN. */
function planItem(itemDir: string): Plan[] {
  const manifestPath = join(itemDir, "registry-item.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as RegistryItem;

  const plans = (manifest.files ?? [])
    .filter(needsHosting)
    .map((file) => hostFile(manifest.name, itemDir, file));

  if (plans.length > 0) {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  }
  return plans;
}

/** Collect every planned object into one flat directory, deduplicated by key. */
function stage(plans: Plan[]): number {
  rmSync(STAGING_DIR, { recursive: true, force: true });
  mkdirSync(STAGING_DIR, { recursive: true });
  const seen = new Set<string>();
  for (const plan of plans) {
    if (seen.has(plan.key)) continue;
    seen.add(plan.key);
    copyFileSync(plan.source, join(STAGING_DIR, plan.key));
  }
  return seen.size;
}

function upload(): void {
  // `s3 sync` rather than `cp --recursive`: keys are content-addressed, so an
  // object already up there is byte-identical and re-sending it is waste.
  //
  // No CloudFront invalidation, and that is not an omission — a new key has
  // never been requested, so no edge holds a stale copy of it. That is the
  // whole point of hashing the name.
  execFileSync(
    "aws",
    [
      "--profile",
      PROFILE,
      "s3",
      "sync",
      `${STAGING_DIR}/`,
      `${S3_DEST}/`,
      "--cache-control",
      "public, max-age=31536000, immutable",
      "--metadata-directive",
      "REPLACE",
    ],
    { stdio: "inherit" },
  );
}

/**
 * Report what would move, changing nothing.
 *
 * Planning writes the manifest, so a dry run restores each one after asking
 * it. Cheaper than a second code path that could disagree with the real one
 * about what counts as hostable.
 */
function reportDryRun(itemDirs: string[]): void {
  for (const dir of itemDirs) {
    const manifestPath = join(dir, "registry-item.json");
    const before = readFileSync(manifestPath, "utf-8");
    const plans = planItem(dir);
    writeFileSync(manifestPath, before, "utf-8");
    if (plans.length > 0) {
      console.log(`${dir.replace(`${repoRoot}/`, "")}: ${plans.length} file(s) would be hosted`);
    }
  }
}

/** Drop the local copies. Only ever called once the bytes are somewhere else. */
function discardStagedSources(plans: Plan[]): void {
  for (const plan of plans) {
    if (existsSync(plan.source)) unlinkSync(plan.source);
  }
  rmSync(STAGING_DIR, { recursive: true, force: true });
}

function resolveItemDirs(argv: string[]): string[] {
  if (argv.includes("--all")) return allItemDirs();
  const names = argv.filter((arg) => !arg.startsWith("--"));
  if (names.length === 0) throw new Error("Nothing to do: pass item names or --all.");
  return names.map(itemDirFor);
}

export async function main(argv: string[]): Promise<void> {
  const itemDirs = resolveItemDirs(argv);

  if (argv.includes("--dry-run")) {
    reportDryRun(itemDirs);
    return;
  }

  const plans = itemDirs.flatMap(planItem);
  if (plans.length === 0) {
    console.log("No unhosted binary assets found — nothing to do.");
    return;
  }

  const objects = stage(plans);
  console.log(
    `Staged ${objects} object(s) from ${plans.length} manifest entr(ies) → ${STAGING_DIR}`,
  );

  if (argv.includes("--no-upload")) {
    console.log(
      `Skipping upload. Publish with:\n  aws --profile ${PROFILE} s3 sync ${STAGING_DIR}/ ${S3_DEST}/ --cache-control "public, max-age=31536000, immutable" --metadata-directive REPLACE`,
    );
    return;
  }

  // Discarding before the upload succeeded would leave manifests pointing at
  // URLs that 404, with no local copy to retry from.
  upload();
  discardStagedSources(plans);
  console.log(`Published ${objects} object(s). Live under ${CDN_BASE}/`);
}

runAsCommand(import.meta.url, () => main(process.argv.slice(2)));
