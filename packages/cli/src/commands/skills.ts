import { defineCommand } from "citty";
import { execFileSync, spawn } from "node:child_process";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { buildNpxCommand } from "../utils/npxCommand.js";
import { withMeta } from "../utils/updateCheck.js";
import { checkSkills, type SkillsCheckResult } from "../utils/skillsManifest.js";
import { mirrorGlobalSkills } from "../utils/skillsMirror.js";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["Install all HyperFrames skills", "hyperframes skills"],
  ["Check whether installed skills are up to date", "hyperframes skills check"],
  ["Check, machine-readable (for agents / CI)", "hyperframes skills check --json"],
  ["Update all skills to the latest (installs any missing)", "hyperframes skills update"],
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

// One faithful global install: --copy lands real files in Claude Code's global
// store (~/.claude/skills, which Claude Code reads at global priority) plus the
// shared universal store (~/.agents/skills). mirrorGlobalSkills then fans that
// store out to every OTHER installed agent's global dir. Skills are
// framework-general knowledge, so installing once globally beats copying a full
// set into every project — and avoids the ~70-agent `--all` spray entirely.
const GLOBAL_INSTALL_ARGS = [
  "--skill",
  "*",
  "--global",
  "--agent",
  "claude-code",
  "universal",
  "--copy",
  "--yes",
];

function runSkillsAdd(
  source: string,
  opts: { cwd?: string; extraArgs?: string[] } = {},
): Promise<void> {
  return spawnNpx(["skills", "add", source, ...(opts.extraArgs ?? GLOBAL_INSTALL_ARGS)], opts);
}

// Use the full GitHub URL (not the `owner/repo` slug) so `skills add` git-clones
// the repo directly at latest `main`, bypassing the skills.sh registry — which
// can lag behind the repo. Our freshness check already resolves "latest"
// straight from GitHub, so this keeps install/update consistent with check.
const SOURCES = [{ name: "HyperFrames", url: "https://github.com/heygen-com/hyperframes" }];

export async function installAllSkills(
  opts: { cwd?: string; extraArgs?: string[]; strict?: boolean } = {},
): Promise<void> {
  if (!hasNpx()) {
    const msg = "npx not found. Install Node.js and retry.";
    // strict callers (e.g. `skills update`) need a real failure so a recovery
    // command can't exit 0 having done nothing; best-effort callers (init) just
    // warn and carry on.
    if (opts.strict) throw new Error(msg);
    clack.log.error(c.error(msg));
    return;
  }

  for (const source of SOURCES) {
    console.log();
    console.log(c.bold(`Installing ${source.name} skills...`));
    console.log();
    try {
      await runSkillsAdd(source.url, opts);
    } catch (err) {
      if (opts.strict) throw err instanceof Error ? err : new Error(String(err));
      console.log(c.dim(`${source.name} skills skipped`));
    }
  }

  // Fan the global Claude store out to every other installed agent. No-op when
  // the global store is absent (e.g. a custom --dir install), so it's safe to
  // run unconditionally after any install path.
  try {
    const { mirrored } = mirrorGlobalSkills();
    if (mirrored.length > 0) {
      console.log(c.dim(`Linked skills into ${mirrored.length} other agent director(ies).`));
    }
  } catch {
    // best-effort: a mirror failure must not fail the install
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
    description: "Update all HyperFrames skills to the latest — installs any not yet present",
  },
  args: {},
  async run() {
    // The global install re-fetches every skill to the latest AND installs ones
    // not yet present, then re-mirrors — so "update" pulls the full set, not
    // just what is already installed. This is where `init` and the stale-skills
    // nudge both lead.
    //
    // strict: this is the documented recovery path for the agent/CI contract
    // `hyperframes skills check || hyperframes skills update`. If the install
    // fails (no npx, `skills add` exits non-zero) it must exit non-zero too —
    // otherwise the `||` chain passes while nothing actually changed.
    try {
      await installAllSkills({ strict: true });
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
