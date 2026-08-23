#!/usr/bin/env tsx
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  PUBLISHABLE_PACKAGES,
  validatePublishablePackages,
  type PublishablePackage,
} from "./release-packages.ts";

const execFileAsync = promisify(execFile);

export type PublishCommand = (
  executable: string,
  args: readonly string[],
  cwd: string,
) => Promise<void>;
type PublishDependencies = {
  packageExists: (npmName: string, version: string) => Promise<boolean>;
  command: PublishCommand;
  log: (message: string) => void;
};
type PublishInput = {
  root: string;
  version: string;
  distTag: string;
  roster?: readonly PublishablePackage[];
};
type PublishResult = { published: string[]; skipped: string[]; failed: string[] };

// The two allowed publish modes converge here so CLI restoration cannot be bypassed.
// fallow-ignore-next-line complexity
async function publishEntry(
  root: string,
  entry: PublishablePackage,
  distTag: string,
  command: PublishCommand,
): Promise<void> {
  if (entry.publishMode === "workspace") {
    await command(
      "pnpm",
      [
        "--filter",
        entry.workspaceName,
        "publish",
        "--access",
        "public",
        "--no-git-checks",
        "--tag",
        distTag,
      ],
      root,
    );
    return;
  }
  const workspace = join(root, entry.workspacePath);
  const manifestPath = join(workspace, "package.json");
  const original = readFileSync(manifestPath, "utf8");
  const manifest: unknown = JSON.parse(original);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw new Error(`Invalid package manifest at ${manifestPath}.`);
  try {
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...manifest, name: entry.npmName }, null, 2)}\n`,
    );
    await command("npm", ["publish", "--access", "public", "--tag", distTag], workspace);
  } finally {
    writeFileSync(manifestPath, original);
  }
}

// Continue-and-aggregate is deliberate: every missing package gets one attempt per rerun.
// fallow-ignore-next-line complexity
export async function runPublishPackages(
  input: PublishInput,
  dependencies: PublishDependencies,
): Promise<PublishResult> {
  const roster = validatePublishablePackages(input.root, input.roster ?? PUBLISHABLE_PACKAGES);
  const result: PublishResult = { published: [], skipped: [], failed: [] };
  for (const entry of roster) {
    if (await dependencies.packageExists(entry.npmName, input.version)) {
      dependencies.log(`⏭️  ${entry.npmName}@${input.version} already published — skipping`);
      result.skipped.push(entry.npmName);
      continue;
    }
    dependencies.log(`📦 Publishing ${entry.npmName}@${input.version}...`);
    try {
      await publishEntry(input.root, entry, input.distTag, dependencies.command);
      dependencies.log(`✅ ${entry.npmName}@${input.version} published`);
      result.published.push(entry.npmName);
    } catch {
      dependencies.log(`❌ ${entry.npmName}@${input.version} failed to publish`);
      result.failed.push(entry.npmName);
    }
  }
  if (result.failed.length > 0)
    throw new Error(`Packages failed to publish: ${result.failed.join(", ")}`);
  return result;
}

const defaultDependencies: PublishDependencies = {
  packageExists: async (npmName, version) => {
    try {
      await execFileAsync("npm", ["view", `${npmName}@${version}`, "version"]);
      return true;
    } catch {
      return false;
    }
  },
  command: async (executable, args, cwd) => {
    await execFileAsync(executable, [...args], { cwd });
  },
  log: console.log,
};

// fallow-ignore-next-line complexity
async function main(): Promise<void> {
  const version = process.env.VERSION ?? "";
  const distTag = process.env.DIST_TAG ?? "";
  if (!version || !distTag) throw new Error("VERSION and DIST_TAG are required.");
  await runPublishPackages(
    { root: join(import.meta.dirname, ".."), version, distTag },
    defaultDependencies,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
