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
import { CLI_SEMVER_PATTERN } from "./cli-options.ts";

const PACKAGES = [
  "packages/core",
  "packages/engine",
  "packages/player",
  "packages/producer",
  "packages/shader-transitions",
  "packages/studio",
  "packages/cli",
  "packages/aws-lambda",
  "packages/gcp-cloud-run",
  "packages/sdk",
];

const PLUGINS = [".claude-plugin", ".codex-plugin", ".cursor-plugin"];

const ROOT = join(import.meta.dirname, "..");
export const CHANGELOG_REVIEW_TODO = "<!-- TODO: write a 1-2 sentence release summary here. -->";

type ReleaseOptions = {
  version: string;
  skipTag: boolean;
  skipChangelogCheck: boolean;
  skipMonotonicityCheck: boolean;
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

  createReleaseCommitAndTag(options.version, options.skipMonotonicityCheck);
  printReleaseNextSteps(options.version);
}

export function parseReleaseOptions(args: string[]): ReleaseOptions {
  const version = args.find((a) => !a.startsWith("--"));
  const skipTag = args.includes("--no-tag");
  const skipChangelogCheck = args.includes("--skip-changelog-check");
  const skipMonotonicityCheck = args.includes("--skip-monotonicity-check");

  if (!version) {
    console.error(
      "Usage: bun run set-version <version> [--no-tag] [--skip-changelog-check] [--skip-monotonicity-check]",
    );
    console.error("Example: bun run set-version 0.1.1");
    process.exit(1);
  }

  if (!CLI_SEMVER_PATTERN.test(version)) {
    console.error(`Invalid semver: ${version}`);
    process.exit(1);
  }

  return { version, skipTag, skipChangelogCheck, skipMonotonicityCheck };
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

function createReleaseCommitAndTag(version: string, skipMonotonicityCheck: boolean = false) {
  if (!skipMonotonicityCheck) {
    assertTagMonotonicity(version);
  }

  const allowedPaths = releaseAllowedPaths(version);
  assertNoUnexpectedChanges(collectChangedPaths(), allowedPaths);

  // Pass git arguments as an array (execFileSync, no shell) so the interpolated
  // version and paths can never be interpreted as shell commands.
  const pathsToAdd = allowedPaths.filter((path) => existsSync(join(ROOT, path)));
  execFileSync("git", ["add", ...pathsToAdd], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore: release v${version}`], {
    cwd: ROOT,
    stdio: "inherit",
  });
  // Annotated tag (-a -m): works regardless of a contributor's git config; a
  // lightweight `git tag` fails ("no tag message?") when tag.forceSignAnnotated
  // or similar is set globally.
  execFileSync("git", ["tag", "-a", `v${version}`, "-m", `v${version}`], {
    cwd: ROOT,
    stdio: "inherit",
  });
  console.log(`\nCreated commit and tag v${version}`);
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function assertTagMonotonicity(version: string) {
  if (isPrerelease(version)) return;

  let tags: string;
  try {
    tags = execFileSync("git", ["tag", "--list", "v[0-9]*"], {
      cwd: ROOT,
      encoding: "utf-8",
    });
  } catch {
    return;
  }

  const stableVersions = tags
    .trim()
    .split("\n")
    .filter((t) => t && !t.includes("-"))
    .map((t) => t.replace(/^v/, ""));

  for (const existing of stableVersions) {
    if (compareSemver(existing, version) > 0) {
      console.error(`\nTag v${existing} already exists and is semver-higher than v${version}.`);
      console.error(`Tag-sorting installers (npx skills, etc.) would resolve the wrong version.`);
      console.error(`\nOptions:`);
      console.error(
        `  Delete the stale tag: git tag -d v${existing} && git push origin :refs/tags/v${existing}`,
      );
      console.error(
        `  Skip this check:     bun run set-version ${version} --skip-monotonicity-check`,
      );
      process.exit(1);
    }
  }
}

export function releaseRequiresChangelog(options: ReleaseOptions) {
  return !options.skipTag && !options.skipChangelogCheck && !isPrerelease(options.version);
}

export function isPrerelease(version: string) {
  return version.includes("-");
}

function assertReviewedChangelog(version: string) {
  const missing = missingChangelogArtifacts(version);
  const unreviewed = unreviewedChangelogArtifacts(version);

  if (missing.length > 0 || unreviewed.length > 0) {
    console.error("\nChangelog review required:");
    missing.forEach((artifact) => console.error(`  ${artifact}`));
    unreviewed.forEach((artifact) =>
      console.error(`  ${artifact} still contains the generated TODO summary`),
    );
    console.error(`\nRun: bun run release:prepare ${version}`);
    console.error(
      "Review and rewrite the generated release notes, then rerun release:prepare. Use --skip-changelog-check only for emergency releases.",
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

export function unreviewedChangelogArtifacts(version: string) {
  return changelogArtifacts(version).filter(
    (artifact) => artifactExists(artifact) && artifactHasGeneratedTodo(artifact),
  );
}

function artifactExists(artifact: string) {
  const [path, marker] = artifact.split("#");
  const absolutePath = join(ROOT, path);

  if (!existsSync(absolutePath)) {
    return false;
  }
  return marker ? readFileSync(absolutePath, "utf-8").includes(`label="${marker}"`) : true;
}

function artifactHasGeneratedTodo(artifact: string) {
  const [path, marker] = artifact.split("#");
  const content = readFileSync(join(ROOT, path), "utf-8");
  if (!marker) {
    return hasGeneratedChangelogTodo(content);
  }

  return docsChangelogEntryHasGeneratedTodo(content, marker);
}

export function hasGeneratedChangelogTodo(content: string) {
  return content.includes(CHANGELOG_REVIEW_TODO);
}

export function docsChangelogEntryHasGeneratedTodo(content: string, marker: string) {
  const labelIndex = content.indexOf(`label="${marker}"`);
  if (labelIndex === -1) {
    return false;
  }

  const entryStart = content.lastIndexOf("<Update", labelIndex);
  const entryEnd = content.indexOf("</Update>", labelIndex);
  const entry = content.slice(
    entryStart === -1 ? labelIndex : entryStart,
    entryEnd === -1 ? undefined : entryEnd + "</Update>".length,
  );

  return hasGeneratedChangelogTodo(entry);
}

export function releaseAllowedPaths(version: string) {
  return [
    ...PACKAGES.map((pkg) => join(pkg, "package.json")),
    ...PLUGINS.map((plugin) => join(plugin, "plugin.json")),
    "docs/changelog.mdx",
    join("releases", `v${version}.md`),
  ];
}

// Collect every uncommitted path (modified-tracked + untracked) as clean,
// repo-relative paths. We deliberately use `diff --name-only` and `ls-files`
// with `-z` rather than parsing `git status --porcelain`: the porcelain
// "XY <path>" prefix width shifts with stage state, and a fixed-width slice
// of it once mis-read a legitimate release file (`.claude-plugin/plugin.json`)
// as an unexpected change, falsely blocking a release. These two commands
// emit bare NUL-separated paths with no status column to misparse.
function collectChangedPaths(): string[] {
  const tracked = execFileSync("git", ["diff", "--name-only", "-z", "HEAD"], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  return [...splitNulList(tracked), ...splitNulList(untracked)];
}

export function splitNulList(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

export function findUnexpectedChanges(changedPaths: string[], allowedPaths: string[]): string[] {
  const allowed = new Set(allowedPaths);
  return changedPaths.filter((path) => !allowed.has(path));
}

function assertNoUnexpectedChanges(changedPaths: string[], allowedPaths: string[]) {
  const unexpected = findUnexpectedChanges(changedPaths, allowedPaths);

  if (unexpected.length > 0) {
    console.error("\nUnexpected uncommitted changes:");
    unexpected.forEach((path) => console.error(`  ${path}`));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
