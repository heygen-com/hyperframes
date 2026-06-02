#!/usr/bin/env tsx

import { execFileSync } from "child_process";
import { join } from "path";
import { pathToFileURL } from "url";
import {
  CLI_SEMVER_PATTERN,
  optionalFlagArg,
  optionalValueArg,
  parseVersionOptionArgument,
  validateCliDate,
  validateCliVersion,
  type InlineValueOption,
} from "./cli-options.ts";
import {
  missingChangelogArtifacts,
  releaseRequiresChangelog,
  unreviewedChangelogArtifacts,
} from "./set-version.ts";

type PrepareOptions = {
  version: string;
  from?: string;
  to?: string;
  date?: string;
  force: boolean;
  skipTag: boolean;
  skipChangelogCheck: boolean;
};

type MutablePrepareOptions = Omit<PrepareOptions, "version"> & {
  version?: string;
};

type ValueOptionKey = "from" | "to" | "date";
type BooleanOptionKey = "force" | "skipTag" | "skipChangelogCheck";
export type StableReleaseAction = "draft" | "review" | "set-version";

const ROOT = join(import.meta.dirname, "..");

const VALUE_OPTIONS = new Map<string, ValueOptionKey>([
  ["--from", "from"],
  ["--to", "to"],
  ["--date", "date"],
]);

const BOOLEAN_OPTIONS = new Map<string, BooleanOptionKey>([
  ["--force", "force"],
  ["--no-tag", "skipTag"],
  ["--skip-changelog-check", "skipChangelogCheck"],
]);

const INLINE_VALUE_OPTIONS = [
  { prefix: "--from=", key: "from" },
  { prefix: "--to=", key: "to" },
  { prefix: "--date=", key: "date" },
] satisfies Array<InlineValueOption<ValueOptionKey>>;

function main() {
  const options = parsePrepareOptions(process.argv.slice(2));

  if (!releaseRequiresChangelog(options)) {
    runSetVersion(options);
    return;
  }

  const missingArtifacts = missingChangelogArtifacts(options.version);
  const unreviewedArtifacts = unreviewedChangelogArtifacts(options.version);
  const action = resolveStableReleaseAction({ missingArtifacts, unreviewedArtifacts });

  if (action === "draft") {
    runDraft(options);
    printReviewNextSteps(options.version, missingArtifacts);
    process.exit(1);
  }

  if (action === "review") {
    printReviewNextSteps(options.version, unreviewedArtifacts);
    process.exit(1);
  }

  runSetVersion(options);
}

export function parsePrepareOptions(args: string[]): PrepareOptions {
  const parsed = createDefaultOptions();

  for (let index = 0; index < args.length; index += 1) {
    index = parseArgument(args, index, parsed);
  }

  return finalizeOptions(parsed);
}

function createDefaultOptions(): MutablePrepareOptions {
  return {
    force: false,
    skipTag: false,
    skipChangelogCheck: false,
  };
}

function parseArgument(args: string[], index: number, parsed: MutablePrepareOptions) {
  return parseVersionOptionArgument(args, index, parsed, {
    inlineValueOptions: INLINE_VALUE_OPTIONS,
    valueOptions: VALUE_OPTIONS,
    booleanOptions: BOOLEAN_OPTIONS,
    printUsage,
    fail,
  });
}

function finalizeOptions(parsed: MutablePrepareOptions): PrepareOptions {
  if (!parsed.version) {
    printUsage();
    process.exit(1);
  }

  validateCliVersion(parsed.version, CLI_SEMVER_PATTERN, fail);
  if (parsed.date) {
    validateCliDate(parsed.date, fail);
  }

  return {
    version: parsed.version,
    from: parsed.from,
    to: parsed.to,
    date: parsed.date,
    force: parsed.force,
    skipTag: parsed.skipTag,
    skipChangelogCheck: parsed.skipChangelogCheck,
  };
}

export function resolveStableReleaseAction(state: {
  missingArtifacts: string[];
  unreviewedArtifacts: string[];
}): StableReleaseAction {
  if (state.missingArtifacts.length > 0) {
    return "draft";
  }
  if (state.unreviewedArtifacts.length > 0) {
    return "review";
  }
  return "set-version";
}

export function buildDraftCommandArgs(options: PrepareOptions) {
  return [
    "run",
    "changelog:draft",
    options.version,
    "--write",
    ...optionalFlagArg("--force", options.force),
    ...optionalValueArg("--from", options.from),
    ...optionalValueArg("--to", options.to),
    ...optionalValueArg("--date", options.date),
  ];
}

export function buildSetVersionCommandArgs(options: PrepareOptions) {
  return [
    "run",
    "set-version",
    options.version,
    ...optionalFlagArg("--no-tag", options.skipTag),
    ...optionalFlagArg("--skip-changelog-check", options.skipChangelogCheck),
  ];
}

function runDraft(options: PrepareOptions) {
  runBun(buildDraftCommandArgs(options));
}

function runSetVersion(options: PrepareOptions) {
  runBun(buildSetVersionCommandArgs(options));
}

function runBun(args: string[]) {
  try {
    execFileSync("bun", args, { cwd: ROOT, stdio: "inherit" });
  } catch (error) {
    const status =
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 1;
    process.exit(status);
  }
}

function printReviewNextSteps(version: string, artifacts: string[]) {
  console.error(`\nRelease v${version} needs reviewed changelog copy before tagging.`);
  if (artifacts.length > 0) {
    console.error("Check:");
    artifacts.forEach((artifact) => console.error(`  ${artifact}`));
  }
  console.error("\nReview and rewrite the generated summary, remove the TODO marker, then rerun:");
  console.error(`  bun run release:prepare ${version}`);
  console.error(
    "\nThe non-zero exit is intentional so chained release commands stop before tagging.",
  );
}

function printUsage() {
  console.log(`Usage:
  bun run release:prepare <version> [--force] [--from <ref>] [--to <ref>] [--date YYYY-MM-DD]
  bun run release:prepare <version> [--no-tag] [--skip-changelog-check]

Examples:
  bun run release:prepare 0.6.53
  bun run release:prepare 0.6.53 --from v0.6.52 --to HEAD
  bun run release:prepare 0.6.53 --force
`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
