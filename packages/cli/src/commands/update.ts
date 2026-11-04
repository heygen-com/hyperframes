import { setCommandExitCode } from "../utils/commandResult.js";
import { defineCommand } from "../utils/defineCommand.js";
import type { Example } from "./_examples.js";
import * as clack from "../ui/prompts.js";
import { c } from "../ui/colors.js";
import { readConfigFresh } from "../telemetry/config.js";
import { isUnattended } from "../utils/attendedTerminal.js";
import { failureMessage, jsonFailure } from "../utils/jsonError.js";
import {
  installChannelLabel,
  runningInstall,
  updateCommandFor,
  type InstallChannel,
} from "../utils/installerDetection.js";
import { checkSkills } from "../utils/skillsManifest.js";
import { recordSkillsCheck } from "../utils/skillsUpdateCheck.js";
import {
  checkForUpdate,
  NO_UPDATE_NOTICE,
  updateCommandForThisInstall,
  withMeta,
} from "../utils/updateCheck.js";
import { VERSION } from "../version.js";
import { skillsManagedExternally, updateSkills, type UpdateSkillsResult } from "./skills.js";
import { upgradeRunningCli, type CliUpgradeOutcome } from "./upgrade.js";

export const examples: Example[] = [
  ["Check the CLI and the skills for updates in one call", "hyperframes update --check"],
  ["The same check, machine-readable (for agents)", "hyperframes update --check --json"],
  ["Update the CLI and the skills without prompting", "hyperframes update --yes"],
];

const PLUGIN_REASON =
  "This CLI runs from an agent plugin, which pins the CLI and its skills; update the plugin through your agent's plugin manager.";

interface CliReport {
  current: string;
  latest: string;
  updateAvailable: boolean;
  /** When the registry answered this run; null when it did not (latest is then the cached value). */
  checkedAt: string | null;
  install: { channel: InstallChannel; path: string | null };
  /** What moves this install to `latest`; null when already current. */
  command: string | null;
}

type SkillsReport =
  | {
      status: "checked";
      /** Repo ref the manifest was read at: this CLI's release tag, or main for a dev build. */
      ref: string | null;
      location: string | null;
      updateAvailable: boolean;
      outdated: number;
      missing: number;
      command: string | null;
    }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

interface UpdateOutcome {
  cli: CliUpgradeOutcome | { status: "current" };
  skills:
    | { status: "updated"; result: UpdateSkillsResult }
    | { status: "current" }
    | { status: "skipped"; reason: string }
    | { status: "failed"; error: string };
}

/** One forced registry check (no cache, no opt-out), reported with where this binary runs from. */
async function checkCli(): Promise<CliReport> {
  const startedAt = Date.now();
  const result = await checkForUpdate(true);
  const stamp = readConfigFresh().lastUpdateCheck;
  const checkedAt = stamp && new Date(stamp).getTime() >= startedAt - 1000 ? stamp : null;
  const install = runningInstall();
  return {
    current: result.current,
    latest: result.latest,
    updateAvailable: result.updateAvailable,
    checkedAt,
    install,
    command: result.updateAvailable ? updateCommandFor(install, result.latest) : null,
  };
}

function skillsSkipReason(channel: InstallChannel): string | null {
  if (channel === "plugin") return PLUGIN_REASON;
  if (skillsManagedExternally()) {
    return "HYPERFRAMES_SKIP_SKILLS=1: skills are managed externally.";
  }
  return null;
}

/** The skills check `skills update` would act on (manifest at this CLI's release tag), cached for `_meta`. */
async function checkInstalledSkills(cli: CliReport): Promise<SkillsReport> {
  const skip = skillsSkipReason(cli.install.channel);
  if (skip) return { status: "skipped", reason: skip };
  try {
    const result = await checkSkills({ canonical: true, cliVersion: VERSION });
    recordSkillsCheck(result);
    return {
      status: "checked",
      ref: result.ref,
      location: result.location,
      updateAvailable: result.updateAvailable,
      outdated: result.summary.outdated,
      missing: result.summary.coreMissing,
      // The command `_meta.updateNotice` names, for both halves: it moves this install.
      command: result.updateAvailable
        ? updateCommandForThisInstall(cli.updateAvailable, true, cli.latest)
        : null,
    };
  } catch (err) {
    return { status: "error", error: failureMessage(err) };
  }
}

/** The CLI half. A project-local CLI is moved by its project's manager: name that, as `--check` does. */
function upgradeCli(cli: CliReport): UpdateOutcome["cli"] {
  if (!cli.updateAvailable) return { status: "current" };
  const upgrade = upgradeRunningCli(cli.latest);
  return upgrade.status === "manual" && cli.command
    ? { ...upgrade, command: cli.command }
    : upgrade;
}

/** Upgrade the CLI the way `upgrade --yes` does, then refresh the skills at the tag of the CLI that runs next. */
async function applyUpdate(cli: CliReport, skills: SkillsReport): Promise<UpdateOutcome> {
  const cliOutcome = upgradeCli(cli);
  if (skills.status === "skipped") return { cli: cliOutcome, skills };
  // Still on this CLI and its skills already match its tag: nothing to install.
  if (cliOutcome.status !== "upgraded" && skills.status === "checked" && !skills.updateAvailable) {
    return { cli: cliOutcome, skills: { status: "current" } };
  }
  // The skills follow the CLI that is installed now, which a brew upgrade may leave short of npm's.
  const cliVersion = cliOutcome.status === "upgraded" ? cliOutcome.version : VERSION;
  try {
    const result = await updateSkills({ refreshInstalled: true, strict: true, cliVersion });
    return { cli: cliOutcome, skills: { status: "updated", result } };
  } catch (err) {
    return { cli: cliOutcome, skills: { status: "failed", error: failureMessage(err) } };
  }
}

function printCheck(cli: CliReport, skills: SkillsReport): void {
  const where = `${installChannelLabel(cli.install.channel)}${cli.install.path ? ` · ${cli.install.path}` : ""}`;
  console.log();
  console.log(c.bold("hyperframes update"));
  console.log();
  const version = cli.updateAvailable
    ? c.warn(`${cli.current} → ${cli.latest} available`)
    : c.success(`${cli.current} (${cli.checkedAt ? "latest" : "npm registry not reached"})`);
  console.log(`  ${c.bold("CLI".padEnd(8))}${version}`);
  console.log(`  ${" ".repeat(8)}${c.dim(where)}`);
  if (cli.command) console.log(`  ${" ".repeat(8)}${c.accent(`Run: ${cli.command}`)}`);
  console.log(`  ${c.bold("Skills".padEnd(8))}${skillsLine(skills)}`);
  if (skills.status === "checked" && skills.command) {
    console.log(`  ${" ".repeat(8)}${c.accent(`Run: ${skills.command}`)}`);
  }
  console.log();
}

function skillsLine(skills: SkillsReport): string {
  if (skills.status === "skipped") return c.dim(skills.reason);
  if (skills.status === "error") return c.warn(`Could not check: ${skills.error}`);
  if (!skills.location) return c.warn("No HyperFrames skills installed");
  const at = skills.ref ? ` at ${skills.ref}` : "";
  if (!skills.updateAvailable) return c.success(`Up to date${at} · ${skills.location}`);
  return c.warn(
    `${skills.outdated} outdated, ${skills.missing} core missing${at} · ${skills.location}`,
  );
}

function cliOutcomeLine(cli: UpdateOutcome["cli"]): string {
  switch (cli.status) {
    case "upgraded":
      return c.success(`CLI upgraded to v${cli.version}.`);
    case "unchanged":
      return c.warn(`CLI stays at v${cli.version}: ${cli.reason}.`);
    case "unverified":
      return c.warn(`CLI: ran ${cli.command}, but ${cli.reason}.`);
    case "manual":
      return c.warn(`CLI: run ${cli.command} (${cli.reason}).`);
    case "failed":
      return c.error(`CLI upgrade failed. Run: ${cli.command}`);
    default:
      return c.success("CLI is up to date.");
  }
}

function printOutcome(outcome: UpdateOutcome): void {
  const { skills } = outcome;
  console.log(cliOutcomeLine(outcome.cli));
  if (skills.status === "updated") {
    const n = skills.result.installed.length;
    console.log(
      c.success(
        n > 0
          ? `Updated ${n} skill(s): ${skills.result.installed.join(", ")}`
          : "Skills are up to date.",
      ),
    );
  } else if (skills.status === "current") {
    console.log(c.success("Skills are up to date."));
  } else if (skills.status === "failed") {
    console.log(c.error(`Skills update failed: ${skills.error}`));
  } else {
    console.log(c.dim(skills.reason));
  }
}

interface Mode {
  json: boolean;
  yes: boolean;
}

/**
 * Whether this run may install. A plugin install refuses (exit 1): the plugin pins the CLI and
 * its skills. A run that cannot prompt needs --yes, like `upgrade` (exit 2 otherwise).
 */
function installAllowed(channel: InstallChannel, mode: Mode): boolean {
  if (channel === "plugin") {
    if (mode.json) {
      console.log(
        JSON.stringify(
          withMeta(jsonFailure("plugin_managed", PLUGIN_REASON), NO_UPDATE_NOTICE),
          null,
          2,
        ),
      );
    } else {
      clack.log.error(c.error(PLUGIN_REASON));
    }
    setCommandExitCode(1);
    return false;
  }
  if (!mode.yes && (mode.json || isUnattended())) {
    clack.confirmationRequired(
      "hyperframes update",
      "Updating is the person's call; `update --check` only reports.",
    );
  }
  return true;
}

/** An attended run without --yes confirms first, and only when there is something to install. */
async function confirmed(cli: CliReport, skills: SkillsReport, mode: Mode): Promise<boolean> {
  const pending = cli.updateAvailable || (skills.status === "checked" && skills.updateAvailable);
  if (mode.yes || mode.json || !pending) return true;
  const go = await clack.confirm({ message: "Update now?" });
  if (clack.isCancel(go) || go !== true) {
    clack.outro(c.dim("Skipped."));
    return false;
  }
  return true;
}

async function installUpdates(cli: CliReport, skills: SkillsReport, mode: Mode): Promise<void> {
  if (!mode.json) printCheck(cli, skills);
  if (!(await confirmed(cli, skills, mode))) return;
  const outcome = await applyUpdate(cli, skills);
  if (mode.json)
    console.log(
      JSON.stringify(withMeta({ cli, skills, updated: outcome }, NO_UPDATE_NOTICE), null, 2),
    );
  else printOutcome(outcome);
  if (outcome.cli.status === "failed" || outcome.skills.status === "failed") {
    setCommandExitCode(1);
  }
}

export default defineCommand({
  meta: {
    name: "update",
    description: "Check the CLI and the skills for updates in one call, and install them",
  },
  args: {
    check: { type: "boolean", description: "Only report what is outdated; install nothing" },
    yes: { type: "boolean", alias: "y", description: "Update without prompting" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const mode: Mode = { json: args.json === true, yes: args.yes === true };
    const install = runningInstall();
    if (args.check !== true && !installAllowed(install.channel, mode)) return;

    const cli = await checkCli();
    const skills = await checkInstalledSkills(cli);
    if (args.check === true) {
      if (mode.json)
        console.log(JSON.stringify(withMeta({ cli, skills }, NO_UPDATE_NOTICE), null, 2));
      else printCheck(cli, skills);
      return;
    }
    await installUpdates(cli, skills, mode);
  },
});
