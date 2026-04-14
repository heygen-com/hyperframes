#!/usr/bin/env tsx
/**
 * Set the version across all publishable packages in the monorepo,
 * then create a git commit and tag.
 *
 * Usage:
 *   bun run set-version 0.1.1          # stable release → npm "latest" tag
 *   bun run set-version 0.1.1-alpha.1  # pre-release  → npm "alpha" tag
 *   bun run set-version 0.1.1 --no-tag # bump only (no commit or tag)
 *
 * All packages share a single version number (fixed versioning).
 * Pre-release suffixes (-alpha, -beta, -rc, etc.) are detected by the
 * publish workflow and published to the corresponding npm dist-tag.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const PACKAGES = [
  "packages/core",
  "packages/engine",
  "packages/player",
  "packages/producer",
  "packages/shader-transitions",
  "packages/studio",
  "packages/cli",
];

const ROOT = join(import.meta.dirname, "..");

function main() {
  const args = process.argv.slice(2);
  const version = args.find((a) => !a.startsWith("--"));
  const skipTag = args.includes("--no-tag");

  if (!version) {
    console.error("Usage: bun run set-version <version> [--no-tag]");
    console.error("Example: bun run set-version 0.1.1");
    process.exit(1);
  }

  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    console.error(`Invalid semver: ${version}`);
    process.exit(1);
  }

  // Update each package.json
  for (const pkg of PACKAGES) {
    const pkgPath = join(ROOT, pkg, "package.json");
    const content = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const oldVersion = content.version;
    content.version = version;
    writeFileSync(pkgPath, JSON.stringify(content, null, 2) + "\n");
    console.log(`  ${content.name}: ${oldVersion} -> ${version}`);
  }

  console.log(`\nSet ${PACKAGES.length} packages to v${version}`);

  if (skipTag) {
    console.log(`\nSkipped commit and tag (--no-tag). Remember to commit and tag manually.`);
    return;
  }

  // Verify working tree is clean (aside from the version bumps we just made)
  const status = execSync("git status --porcelain", {
    cwd: ROOT,
    encoding: "utf-8",
  }).trim();
  const unexpected = status
    .split("\n")
    .filter((line) => line && !PACKAGES.some((pkg) => line.includes(pkg)));
  if (unexpected.length > 0) {
    console.error("\nUnexpected uncommitted changes:");
    unexpected.forEach((line) => console.error(`  ${line}`));
    console.error("Commit or stash these before releasing.");
    process.exit(1);
  }

  execSync(`git add ${PACKAGES.map((p) => join(p, "package.json")).join(" ")}`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  execSync(`git commit -m "chore: release v${version}"`, { cwd: ROOT, stdio: "inherit" });
  execSync(`git tag v${version}`, { cwd: ROOT, stdio: "inherit" });
  console.log(`\nCreated commit and tag v${version}`);

  const isPrerelease = version.includes("-");
  if (isPrerelease) {
    const distTag = version.replace(/^.*-([a-zA-Z]+).*$/, "$1");
    console.log(`\nThis is a pre-release — npm dist-tag will be "${distTag}" (not "latest").`);
    console.log(`Consumers install with: npm install @hyperframes/core@${distTag}`);
    console.log(`\nRun 'git push origin v${version}' to trigger the publish workflow.`);
  } else {
    console.log(`Run 'git push origin main --tags' to trigger the publish workflow.`);
  }
}

main();
