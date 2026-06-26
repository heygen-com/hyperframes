import { defineCommand } from "citty";
import { execFileSync, spawn } from "node:child_process";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { buildNpxCommand } from "../utils/npxCommand.js";
import { withMeta } from "../utils/updateCheck.js";
import { checkSkills, type SkillsCheckResult } from "../utils/skillsManifest.js";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["Install all HyperFrames skills", "hyperframes skills"],
  ["Check whether installed skills are up to date", "hyperframes skills check"],
  ["Check, machine-readable (for agents / CI)", "hyperframes skills check --json"],
  ["Update installed skills to the latest", "hyperframes skills update"],
];

function hasNpx(): boolean {
  const npx = buildNpxCommand(["--version"]);
  try {
    execFileSync(npx.command, npx.args, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function spawnNpx(args: string[], opts: { cwd?: string } = {}): Promise<void> {
  const npx = buildNpxCommand(args);
  return new Promise((resolve, reject) => {
    const child = spawn(npx.command, npx.args, {
      stdio: "inherit",
      timeout: 120_000,
      cwd: opts.cwd,
      // GH #316 — the upstream `skills` CLI shells out to `git clone`.
      // When Git's clone-hook protection is active (shipped on by default in
      // 2.45.1, reverted in 2.45.2, still present on many corporate and CI
      // setups), a globally-registered `git lfs install` post-checkout hook
      // aborts the clone. The args reaching this function are hardcoded — no
      // user input reaches the spawn — so opting out here is safe.
      env: { ...process.env, GIT_CLONE_PROTECTION_ACTIVE: "0" },
    });
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else if (signal === "SIGINT" || code === 130) process.exit(0);
      else reject(new Error(`npx ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function runSkillsAdd(
  repo: string,
  opts: { cwd?: string; extraArgs?: string[] } = {},
): Promise<void> {
  return spawnNpx(["skills", "add", repo, ...(opts.extraArgs ?? ["--all"])], opts);
}

const SOURCES = [{ name: "HyperFrames", repo: "heygen-com/hyperframes" }];

export async function installAllSkills(
  opts: { cwd?: string; extraArgs?: string[] } = {},
): Promise<void> {
  if (!hasNpx()) {
    clack.log.error(c.error("npx not found. Install Node.js and retry."));
    return;
  }

  for (const source of SOURCES) {
    console.log();
    console.log(c.bold(`Installing ${source.name} skills...`));
    console.log();
    try {
      await runSkillsAdd(source.repo, opts);
    } catch {
      console.log(c.dim(`${source.name} skills skipped`));
    }
  }
}

// ── check ────────────────────────────────────────────────────────────────────

function renderCheck(result: SkillsCheckResult): void {
  const { summary } = result;
  console.log();
  console.log(c.bold("hyperframes skills"));
  console.log();

  if (!result.location) {
    console.log(`  ${c.dim("No HyperFrames skills found in the usual locations.")}`);
    console.log(`  ${c.accent("Install: npx hyperframes skills")}`);
    console.log();
    return;
  }

  console.log(`  ${c.bold("Location")}  ${c.dim(result.location)} ${c.dim(`(${result.agent})`)}`);
  console.log();

  const parts = [c.success(`✓ ${summary.current} current`)];
  if (summary.outdated) parts.push(c.warn(`↑ ${summary.outdated} outdated`));
  if (summary.missing) parts.push(c.dim(`◦ ${summary.missing} not installed`));
  console.log(`  ${parts.join("   ")}`);

  const outdated = result.skills.filter((s) => s.status === "outdated");
  const missing = result.skills.filter((s) => s.status === "missing");

  if (outdated.length) {
    console.log();
    console.log(`  ${c.warn("Outdated:")}`);
    for (const s of outdated) console.log(`    ${c.warn("↑")} ${s.name}`);
  }
  if (missing.length) {
    console.log();
    console.log(`  ${c.dim("Not installed:")}`);
    for (const s of missing) console.log(`    ${c.dim("◦ " + s.name)}`);
  }

  console.log();
  if (result.updateAvailable) {
    console.log(`  ${c.accent("Update: npx hyperframes skills update")}`);
  } else {
    console.log(`  ${c.success("◇")}  ${c.success("Installed skills are up to date")}`);
  }
  console.log();
}

const checkCommand = defineCommand({
  meta: { name: "check", description: "Check whether installed skills are the latest version" },
  args: {
    json: { type: "boolean", description: "Output as JSON", default: false },
    dir: { type: "string", description: "Skills directory to check (default: auto-detect)" },
    source: {
      type: "string",
      description: "Where 'latest' comes from: local path, owner/repo, or URL",
    },
  },
  async run({ args }) {
    const result = await checkSkills({
      dir: args.dir as string | undefined,
      source: args.source as string | undefined,
    });

    if (args.json) console.log(JSON.stringify(withMeta(result), null, 2));
    else renderCheck(result);

    // Exit non-zero when installed skills are stale, so agents and CI can gate:
    //   hyperframes skills check || npx hyperframes skills update
    if (result.updateAvailable) process.exitCode = 1;
  },
});

// ── update ───────────────────────────────────────────────────────────────────

const updateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update installed HyperFrames skills to the latest version",
  },
  args: {
    yes: { type: "boolean", description: "Skip prompts (auto-detect scope)", default: false },
  },
  async run({ args }) {
    if (!hasNpx()) {
      clack.log.error(c.error("npx not found. Install Node.js and retry."));
      return;
    }
    // The upstream `skills` CLI owns the update mechanism (reads
    // skills-lock.json and re-fetches changed skills). We wrap it so agents and
    // users reference one tool, and so the passive nudge can point here.
    console.log();
    console.log(c.bold("Updating HyperFrames skills..."));
    console.log();
    const updateArgs = ["skills", "update"];
    if (args.yes) updateArgs.push("--yes");
    try {
      await spawnNpx(updateArgs);
    } catch (err) {
      clack.log.error(c.error(`Update failed: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  },
});

export default defineCommand({
  meta: {
    name: "skills",
    description: "Install, check, and update HyperFrames skills for AI coding tools",
  },
  subCommands: {
    check: checkCommand,
    update: updateCommand,
  },
  args: {},
  async run({ args }) {
    // citty runs this parent handler even when a subcommand matches; guard on
    // the positional so bare `hyperframes skills` installs, while
    // `hyperframes skills check|update` does not also re-install.
    if (!args._?.[0]) await installAllSkills();
  },
});
