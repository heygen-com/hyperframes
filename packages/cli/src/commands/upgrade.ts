import { setCommandExitCode } from "../utils/commandResult.js";
import { defineCommand } from "../utils/defineCommand.js";
import type { Example } from "./_examples.js";
import * as clack from "../ui/prompts.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { join, resolve } from "node:path";
import { c } from "../ui/colors.js";
import { isUnattended } from "../utils/attendedTerminal.js";
import { rewritePinnedHyperframesText, rewriteProjectPinnedScripts } from "../utils/projectPin.js";

export const examples: Example[] = [
  ["Check for updates interactively", "hyperframes upgrade"],
  ["Check for updates without prompting", "hyperframes upgrade --check"],
  ["Upgrade non-interactively", "hyperframes upgrade --yes"],
  ["Bump a project's pinned CLI scripts", "hyperframes upgrade --project"],
];
import { VERSION } from "../version.js";
import {
  checkForUpdate,
  NO_UPDATE_NOTICE,
  withMeta,
  isSafeVersion,
  type UpdateCheckResult,
} from "../utils/updateCheck.js";
import {
  detectInstaller,
  installInvocation,
  type InstallInvocation,
} from "../utils/installerDetection.js";

export default defineCommand({
  meta: { name: "upgrade", description: "Check for updates and show upgrade instructions" },
  args: {
    yes: { type: "boolean", alias: "y", description: "Show upgrade commands without prompting" },
    check: { type: "boolean", description: "Check for updates and exit (no prompt)" },
    json: { type: "boolean", description: "Output as JSON", default: false },
    project: {
      type: "string",
      description:
        "Bump this project's package.json hyperframes@<version> script pins to latest (default: current dir)",
    },
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const useJson = args.json === true;
    const checkOnly = args.check === true;

    if (args.project !== undefined) {
      const p = resolveProjectArgs(args.project, { check: checkOnly, json: useJson });
      const res = await upgradeProjectPins(resolve(p.dir), { json: p.json, check: p.check });
      if (p.json) {
        console.log(JSON.stringify(withMeta(res, NO_UPDATE_NOTICE), null, 2));
        return;
      }
      printProjectPinResult(res, p.check);
      return;
    }

    // JSON mode: always force-check and output structured data
    if (useJson) {
      const result = await checkForUpdate(true);
      console.log(JSON.stringify(withMeta(result, NO_UPDATE_NOTICE), null, 2));
      return;
    }

    const autoYes = args.yes === true;
    if (!autoYes && !checkOnly && isUnattended()) {
      clack.confirmationRequired(
        "hyperframes upgrade",
        "Pass --yes to upgrade, or --check to only look for a new version.",
      );
    }
    clack.intro(c.bold("hyperframes upgrade"));

    const s = clack.spinner();
    s.start("Checking for updates...");

    const result = await checkForUpdate(true);

    if (result.latest === result.current) {
      s.stop(c.success("Already up to date"));
      clack.outro(`${c.success("\u25C7")}  ${c.bold("v" + VERSION)}`);
      return;
    }

    s.stop("Update available");

    console.log();
    console.log(`   ${c.dim("Current:")}  ${c.bold("v" + result.current)}`);
    console.log(`   ${c.dim("Latest:")}   ${c.bold(c.accent("v" + result.latest))}`);
    console.log();

    if (checkOnly) {
      clack.outro(c.accent("Update available: v" + result.latest));
      return;
    }

    if (!autoYes && !(await confirmUpgrade())) {
      clack.outro(c.dim("Skipped."));
      return;
    }

    applyUpgrade(result, autoYes);
  },
});

/** Interactive "Upgrade now?" prompt; false on decline or cancel. */
async function confirmUpgrade(): Promise<boolean> {
  const shouldUpgrade = await clack.confirm({ message: "Upgrade now?" });
  return !clack.isCancel(shouldUpgrade) && shouldUpgrade === true;
}

/**
 * Show (or, with `autoYes`, run) the upgrade for the user's ACTUAL install
 * method — not a hardcoded `npm install -g`, which fails or silently shadows a
 * bun/pnpm/brew install. Extracted from `run` to keep that handler simple.
 */
// fallow-ignore-next-line complexity
function applyUpgrade(result: UpdateCheckResult, autoYes: boolean): void {
  // Reject anything that isn't a strict semver before it reaches a command. A
  // poisoned npm registry response could otherwise put shell metacharacters
  // into `result.latest`; the guard means the version flows through execFile
  // (and the displayed command) as an opaque token. Shared with the update
  // notice via isSafeVersion.
  if (!isSafeVersion(result.latest)) {
    clack.outro(c.dim("Refusing to install: unexpected version string from npm registry."));
    setCommandExitCode(1);
    return;
  }

  const plan = upgradePlan(result.latest);
  if ("manual" in plan) {
    printNpxFallback(plan.reason, plan.manual, autoYes);
    return;
  }

  if (!autoYes) {
    printManualCommands(plan.displayCmd, `npx hyperframes@${result.latest}`);
    return;
  }

  runDetectedInstall(plan.invocation, plan.displayCmd, result.latest);
}

const NPX_LATEST = "npx hyperframes@latest";

/**
 * How `upgrade --yes` moves this install to `latest`: the detected manager's argv, or, for an
 * install no manager owns (npx/bunx, project-local, workspace, unknown), the npx line to run
 * instead of a guessed manager command.
 */
function upgradePlan(
  latest: string,
):
  | { invocation: InstallInvocation; displayCmd: string; pinsVersion: boolean }
  | { manual: string; reason: string } {
  const installer = detectInstaller();
  const invocation = installInvocation(installer.kind, latest);
  const displayCmd = installer.installCommand(latest);
  if (!invocation || !displayCmd) return { manual: NPX_LATEST, reason: installer.reason };
  return { invocation, displayCmd, pinsVersion: installer.kind !== "brew" };
}

export type CliUpgradeOutcome =
  | { status: "upgraded"; version: string; command: string }
  | { status: "unchanged"; version: string; command: string; reason: string }
  | { status: "unverified"; command: string; reason: string }
  | { status: "manual"; command: string; reason: string }
  | { status: "failed"; command: string };

/** The version Homebrew's linked `hyperframes` reports, or null when it cannot be read. */
function brewInstalledVersion(): string | null {
  try {
    const prefix = execFileSync("brew", ["--prefix", "hyperframes"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    }).trim();
    const version = execFileSync(join(prefix, "bin", "hyperframes"), ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
      env: { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_NO_TELEMETRY: "1" },
    }).trim();
    return isSafeVersion(version) ? version : null;
  } catch {
    return null;
  }
}

/**
 * `upgrade --yes` without its prose, for `hyperframes update`: the same plan and argv, and the
 * installer's output goes to stderr so a --json stdout stays one parseable object.
 */
export function upgradeRunningCli(latest: string): CliUpgradeOutcome {
  if (!isSafeVersion(latest)) return { status: "failed", command: NPX_LATEST };
  const plan = upgradePlan(latest);
  if ("manual" in plan) return { status: "manual", command: plan.manual, reason: plan.reason };
  try {
    execFileSync(plan.invocation.bin, plan.invocation.args, {
      stdio: ["inherit", 2, 2],
      shell: false,
    });
  } catch {
    return { status: "failed", command: plan.displayCmd };
  }
  // `brew upgrade` installs whatever the formula pins, which can lag npm, and exits 0 on a no-op.
  const installed = plan.pinsVersion ? latest : brewInstalledVersion();
  const command = plan.displayCmd;
  if (installed === null) {
    return { status: "unverified", command, reason: "the installed version could not be read" };
  }
  if (installed === VERSION) {
    const reason = `${command} left ${installed} in place; npm has ${latest}`;
    return { status: "unchanged", version: installed, command, reason };
  }
  return { status: "upgraded", version: installed, command };
}

function printNpxFallback(reason: string, npxFallback: string, autoYes: boolean): void {
  console.log();
  if (autoYes) {
    console.log(
      `   ${c.dim("Couldn't detect a global install to upgrade")} ${c.dim("(" + reason + ")")}`,
    );
  }
  console.log(`   ${c.accent(npxFallback)}`);
  console.log();
  clack.outro(c.success("Run the command above to use the latest version."));
}

function printManualCommands(displayCmd: string, npxFallback: string): void {
  console.log();
  console.log(`   ${c.accent(displayCmd)}`);
  console.log(`   ${c.dim("or")}`);
  console.log(`   ${c.accent(npxFallback)}`);
  console.log();
  clack.outro(c.success("Run one of the commands above to upgrade."));
}

/**
 * citty parses `--project` as a string option, so a bare `--project` followed
 * by another flag consumes that flag as its value (`upgrade --project --check`
 * arrives here as project="--check"). A leading dash can never be a real
 * directory argument, so reclaim the eaten token as the flag the user wrote
 * and fall back to the current directory.
 */
export function resolveProjectArgs(
  project: string | boolean,
  opts: { check: boolean; json: boolean },
): { dir: string; check: boolean; json: boolean } {
  if (typeof project !== "string" || project.length === 0) {
    return { dir: ".", check: opts.check, json: opts.json };
  }
  if (project.startsWith("-")) {
    return {
      dir: ".",
      check: opts.check || project === "--check",
      json: opts.json || project === "--json",
    };
  }
  return { dir: project, check: opts.check, json: opts.json };
}

export async function upgradeProjectPins(
  dir: string,
  opts: { json: boolean; check: boolean },
): Promise<{ changed: boolean; from: string[]; to: string; path: string }> {
  const pkgPath = resolve(dir, "package.json");
  if (!existsSync(pkgPath)) {
    return { changed: false, from: [], to: "", path: pkgPath };
  }
  const raw = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = raw.scripts ?? {};
  const { latest } = await checkForUpdate(true);
  if (!isSafeVersion(latest)) return { changed: false, from: [], to: latest, path: pkgPath };
  const rewrite = rewriteProjectPinnedScripts(scripts, latest);
  const wrapperRewrites = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sh"))
    .map((entry) => {
      const path = resolve(dir, entry.name);
      return { path, rewrite: rewritePinnedHyperframesText(readFileSync(path, "utf-8"), latest) };
    });
  if (rewrite.changed && !opts.check) {
    raw.scripts = rewrite.scripts;
    replaceFileAtomically(pkgPath, `${JSON.stringify(raw, null, 2)}\n`);
  }
  if (!opts.check) {
    for (const wrapper of wrapperRewrites) {
      if (wrapper.rewrite.changed) writeFileSync(wrapper.path, wrapper.rewrite.text, "utf-8");
    }
  }
  const from = new Set(rewrite.fromVersions);
  for (const wrapper of wrapperRewrites) {
    for (const version of wrapper.rewrite.fromVersions) from.add(version);
  }
  return { changed: from.size > 0, from: [...from].sort(), to: latest, path: pkgPath };
}

function printProjectPinResult(
  res: { changed: boolean; from: string[]; to: string; path: string },
  checkOnly: boolean,
): void {
  if (!existsSync(res.path)) {
    console.log(`   ${c.dim("No package.json found — nothing to upgrade.")}`);
    return;
  }
  if (!res.changed) {
    console.log(`   ${c.success("◇")}  Project pins already on hyperframes@${res.to}`);
    return;
  }
  const verb = checkOnly ? "would bump" : "bumped";
  console.log(
    `   ${c.success("◇")}  ${verb} project pins ${res.from.join(", ")} → ${c.accent(res.to)}`,
  );
  if (checkOnly)
    console.log(`   ${c.dim("Run `npx hyperframes@latest upgrade --project` to apply.")}`);
}

export function runDetectedInstall(
  invocation: { bin: string; args: string[] },
  displayCmd: string,
  version: string,
): void {
  console.log();
  console.log(`   ${c.dim("Running:")} ${c.accent(displayCmd)}`);
  console.log();
  try {
    // shell:false — version is provably safe per isSafeVersion above; keep the
    // no-shell call so future edits can't regress the injection surface.
    execFileSync(invocation.bin, invocation.args, { stdio: "inherit", shell: false });
    clack.outro(c.success(`Upgraded to v${version}`));
  } catch {
    clack.outro(c.dim("Install failed. Try running manually:"));
    console.log(`   ${c.accent(displayCmd)}`);
    setCommandExitCode(1);
  }
}
