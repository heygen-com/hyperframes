#!/usr/bin/env tsx
/**
 * Set the version across all publishable packages and plugins in the monorepo,
 * then create a git commit and tag.
 *
 * Usage:
 *   bun run set-version 0.1.1          # stable release → npm "latest" tag
 *   bun run set-version 0.1.1-alpha.1  # pre-release  → npm "alpha" tag
 *   bun run set-version 0.1.1 --no-tag # bump only (no commit or tag)
 *   bun run set-version 0.1.1 --skip-changelog-check # emergency stable release
 *
 * All packages and plugins share a single version number (fixed versioning).
 * Pre-release suffixes (-alpha, -beta, -rc, etc.) are detected by the
 * publish workflow and published to the corresponding npm dist-tag.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { pathToFileURL } from "url";

const PACKAGES = [
  "packages/core",
  "packages/engine",
  "packages/player",
  "packages/producer",
  "packages/shader-transitions",
  "packages/studio",
  "packages/cli",
  "packages/aws-lambda",
];

const PLUGINS = [".claude-plugin", ".codex-plugin", ".cursor-plugin"];

const ROOT = join(import.meta.dirname, "..");

type ReleaseOptions = {
  version: string;
  skipTag: boolean;
  skipChangelogCheck: boolean;
};

function main() {
  const options = parseReleaseOptions(process.argv.slice(2));
  if (releaseRequiresChangelog(options)) {
    assertReviewedChangelog(options.version);
  }

  updatePackageVersions(options.version);
  updatePluginVersions(options.version);

  console.log(
    `\nSet ${PACKAGES.length} packages and ${PLUGINS.length} plugin manifests to v${options.version}`,
  );

  if (options.skipTag) {
    console.log(`\nSkipped commit and tag (--no-tag). Remember to commit and tag manually.`);
    return;
  }

  createReleaseCommitAndTag(options.version);
  printReleaseNextSteps(options.version);
}

export function parseReleaseOptions(args: string[]): ReleaseOptions {
  const version = args.find((a) => !a.startsWith("--"));
  const skipTag = args.includes("--no-tag");
  const skipChangelogCheck = args.includes("--skip-changelog-check");

  if (!version) {
    console.error("Usage: bun run set-version <version> [--no-tag] [--skip-changelog-check]");
    console.error("Example: bun run set-version 0.1.1");
    process.exit(1);
  }

  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    console.error(`Invalid semver: ${version}`);
    process.exit(1);
  }

  return { version, skipTag, skipChangelogCheck };
}

function updatePackageVersions(version: string) {
  for (const pkg of PACKAGES) {
    const pkgPath = join(ROOT, pkg, "package.json");
    const content = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const oldVersion = content.version;
    content.version = version;
    writeFileSync(pkgPath, JSON.stringify(content, null, 2) + "\n");
    console.log(`  ${content.name}: ${oldVersion} -> ${version}`);
  }
}

function updatePluginVersions(version: string) {
  // Update each plugin.json. Replace just the version string rather than
  // round-tripping through JSON.parse/stringify: oxfmt keeps these manifests'
  // short arrays inline, but JSON.stringify expands them, which would fail the
  // pre-commit format check on the release commit this script creates.
  for (const plugin of PLUGINS) {
    const pluginPath = join(ROOT, plugin, "plugin.json");
    const text = readFileSync(pluginPath, "utf-8");
    const oldVersion = text.match(/"version"\s*:\s*"([^"]*)"/)?.[1] ?? "unknown";
    writeFileSync(pluginPath, text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`));
    console.log(`  ${plugin}: ${oldVersion} -> ${version}`);
  }
}

function createReleaseCommitAndTag(version: string) {
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf-8",
  }).trim();
  const allowedPaths = releaseAllowedPaths(version);
  assertNoUnexpectedChanges(status, allowedPaths);

  // Pass git arguments as an array (execFileSync, no shell) so the interpolated
  // version and paths can never be interpreted as shell commands.
  const pathsToAdd = allowedPaths.filter((path) => existsSync(join(ROOT, path)));
  execFileSync("git", ["add", ...pathsToAdd], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore: release v${version}`], {
    cwd: ROOT,
    stdio: "inherit",
  });
  execFileSync("git", ["tag", `v${version}`], { cwd: ROOT, stdio: "inherit" });
  console.log(`\nCreated commit and tag v${version}`);
}

export function releaseRequiresChangelog(options: ReleaseOptions) {
  return !options.skipTag && !options.skipChangelogCheck && !isPrerelease(options.version);
}

export function isPrerelease(version: string) {
  return version.includes("-");
}

function assertReviewedChangelog(version: string) {
  const missing = missingChangelogArtifacts(version);

  if (missing.length > 0) {
    console.error("\nMissing reviewed changelog artifacts:");
    missing.forEach((artifact) => console.error(`  ${artifact}`));
    console.error(`\nRun: bun run changelog:draft ${version} --write`);
    console.error(
      "Review and rewrite the generated release notes, then rerun set-version. Use --skip-changelog-check only for emergency releases.",
    );
    process.exit(1);
  }
}

export function missingChangelogArtifacts(version: string) {
  return changelogArtifacts(version).filter((artifact) => !artifactExists(artifact));
}

export function changelogArtifacts(version: string) {
  return [join("releases", `v${version}.md`), `docs/changelog.mdx#HyperFrames v${version}`];
}

function artifactExists(artifact: string) {
  const [path, marker] = artifact.split("#");
  const absolutePath = join(ROOT, path);

  if (!existsSync(absolutePath)) {
    return false;
  }
  return marker ? readFileSync(absolutePath, "utf-8").includes(`label="${marker}"`) : true;
}

function releaseAllowedPaths(version: string) {
  return [
    ...PACKAGES.map((pkg) => join(pkg, "package.json")),
    ...PLUGINS.map((plugin) => join(plugin, "plugin.json")),
    "docs/changelog.mdx",
    join("releases", `v${version}.md`),
  ];
}

function assertNoUnexpectedChanges(status: string, allowedPaths: string[]) {
  const unexpected = status
    .split("\n")
    .filter(
      (line) => line && !allowedPaths.some((allowedPath) => gitStatusPath(line) === allowedPath),
    );

  if (unexpected.length > 0) {
    console.error("\nUnexpected uncommitted changes:");
    unexpected.forEach((line) => console.error(`  ${line}`));
    console.error("Commit or stash these before releasing.");
    process.exit(1);
  }
}

function printReleaseNextSteps(version: string) {
  if (isPrerelease(version)) {
    const distTag = version.replace(/^.*-([a-zA-Z]+).*$/, "$1");
    console.log(`\nThis is a pre-release — npm dist-tag will be "${distTag}" (not "latest").`);
    console.log(`Consumers install with: npm install @hyperframes/core@${distTag}`);
    console.log(`\nRun 'git push origin v${version}' to trigger the publish workflow.`);
  } else {
    console.log(`Run 'git push origin main --tags' to trigger the publish workflow.`);
  }
}

export function gitStatusPath(line: string) {
  return line.slice(3).replace(/^"|"$/g, "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
