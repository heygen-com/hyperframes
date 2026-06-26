import { defineCommand } from "citty";
import { execFileSync, spawn } from "node:child_process";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { buildNpxCommand } from "../utils/npxCommand.js";
import { withMeta } from "../utils/updateCheck.js";
import {
  checkSkills,
  SKILLS_CLI_LOCK_PATHS_VERIFIED_AT,
  type SkillDiff,
  type SkillsCheckResult,
} from "../utils/skillsManifest.js";
import { buildSkillsAddArgs, resolveAgentTargets } from "../utils/skillsTargets.js";
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

function runSkillsAdd(
  source: string,
  opts: { cwd?: string; extraArgs?: string[] } = {},
): Promise<void> {
  // Targeting: an explicit `extraArgs` wins (callers/tests that know exactly
  // what they want); otherwise resolve which agents to install to. We must NOT
  // use the upstream `--all` (= `--skill '*' --agent '*' -y`), which sprays the
  // skills into every one of ~70 agent conventions on the machine. Instead we
  // install every skill (`--skill '*'`) to a scoped agent set: the project's
  // existing skill folders, else the agent running us / installed agent CLIs,
  // else a Claude-Code + `.agents` floor. See resolveAgentTargets.
  let extraArgs = opts.extraArgs;
  if (!extraArgs) {
    const targets = resolveAgentTargets({
      cwd: opts.cwd ?? process.cwd(),
      env: process.env,
      pathStr: process.env["PATH"] ?? "",
      platform: process.platform,
    });
    console.log(c.dim(`Installing to: ${targets.agents.join(", ")} — ${targets.reason}`));
    extraArgs = buildSkillsAddArgs(targets.agents);
  }

  // `--copy` writes real files into each target agent's skills dir, instead of
  // the upstream default (a canonical `.agents/skills` store + per-agent
  // symlinks). That default re-serialises each SKILL.md's frontmatter, so an
  // installed bundle no longer byte-matches the published manifest — `skills
  // check` then reports a freshly-installed set as outdated, and the symlinked
  // layout doesn't reliably land where the agent actually reads. Real copies
  // keep the install faithful to the manifest and detectable by `skills check`.
  return spawnNpx(["skills", "add", source, ...extraArgs, "--copy"], opts);
}

// Skill names are kebab-case directory names. Refuse anything that isn't one
// before spreading it into a spawn: a corrupt or crafted lock entry (these
// names originate as lock-file JSON keys) could otherwise smuggle a flag-like
// (`--config=…`) or shell-special token into the command — which matters most
// on the Windows `cmd.exe` spawn path, where arg escaping is fragile.
const PLAIN_SKILL_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

function runSkillsRemove(names: string[], opts: { global: boolean }): Promise<void> {
  const safe = names.filter((n) => PLAIN_SKILL_NAME.test(n));
  const rejected = names.filter((n) => !PLAIN_SKILL_NAME.test(n));
  if (rejected.length) {
    clack.log.warn(c.warn(`Skipping unexpected skill name(s): ${rejected.join(", ")}`));
  }
  if (!safe.length) return Promise.resolve();
  // `skills remove --yes` deletes the bundle dir, every agent symlink, and the
  // lock entry non-interactively. `-g` targets the global install; without it,
  // the project (cwd) install — we pass whichever scope detection attributed
  // these names from, so we never reach into a scope we didn't inspect.
  return spawnNpx(["skills", "remove", ...safe, ...(opts.global ? ["-g"] : []), "--yes"]);
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
}

// ── check ────────────────────────────────────────────────────────────────────

/** Print a labelled list of skills (nothing if empty), each line uniformly coloured. */
function printSkillSection(
  result: SkillsCheckResult,
  status: SkillDiff["status"],
  title: string,
  mark: string,
  color: (s: string) => string,
): void {
  const items = result.skills.filter((s) => s.status === status);
  if (!items.length) return;
  console.log();
  console.log(`  ${color(title)}`);
  for (const s of items) console.log(`    ${color(`${mark} ${s.name}`)}`);
}

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
  if (summary.removed) parts.push(c.warn(`✗ ${summary.removed} removed upstream`));
  console.log(`  ${parts.join("   ")}`);

  printSkillSection(result, "outdated", "Outdated:", "↑", c.warn);
  printSkillSection(result, "missing", "Not installed:", "◦", c.dim);
  printSkillSection(
    result,
    "removed",
    "Removed upstream (renamed or dropped — no longer published):",
    "✗",
    c.warn,
  );

  // Removed-detection cross-references the upstream skills lock. If that lock is
  // absent where we expect it (e.g. upstream moved its path), removed-detection
  // silently reports zero — so warn rather than imply a clean "up to date".
  if (result.lockMissing) {
    console.log();
    console.log(
      `  ${c.warn(`! Skills lock not found — can't check for skills removed upstream.`)}`,
    );
    console.log(
      `  ${c.dim(`  (lock paths verified against ${SKILLS_CLI_LOCK_PATHS_VERIFIED_AT})`)}`,
    );
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
      dir: args.dir,
      source: args.source,
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
    description:
      "Update all HyperFrames skills to the latest — installs any not yet present, removes any no longer published",
  },
  // Mirror `check`'s flags: the prune step runs the same removed-detection, so it
  // must respect the same overrides. Without these, `update`'s internal
  // checkSkills() fell back to defaults — pruning the auto-detected install
  // against the default manifest even when the user pointed `check` elsewhere.
  args: {
    dir: {
      type: "string",
      description:
        "Skills dir for removed-detection only — scopes the prune, not the install (default: auto-detect)",
    },
    source: {
      type: "string",
      description:
        "Where 'latest' comes from for removed-detection (local path, owner/repo, or URL) — does not change the install source",
    },
  },
  async run({ args }) {
    const dir = args.dir;
    const source = args.source;

    // The install re-fetches every skill to the latest AND installs ones not yet
    // present — so "update" pulls the full set, not just what is already
    // installed. This is where `init` and the stale-skills nudge both lead.
    // runSkillsAdd resolves the agent target set itself (existing project
    // folders → installed CLIs → a Claude-Code + `.agents` floor); we no longer
    // spray to every agent via `--all`.
    //
    // Note: the upstream `skills add` CLI has no `--dir` flag (it installs into
    // the resolved agent dirs), so `--dir` here scopes only the *prune* detection
    // below, not the install. `--source` likewise drives where the prune's
    // "latest" manifest comes from; the install always targets the canonical
    // HyperFrames repo so `update` reliably pulls the published set.
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
      return;
    }

    // `skills add` never deletes, so a skill renamed or dropped upstream
    // (e.g. graphic-overlays → talking-head-recut) would linger forever. Prune
    // skills the lock attributes to our source that the manifest no longer
    // ships, so `check || update` fully reconciles the install to the manifest.
    //
    // Safety: `removed` only ever contains skills the lock records as installed
    // from our source (see detectRemoved) — never a user's own or another
    // source's skills. We remove in the exact scope detection attributed from,
    // so we never reach into a scope we didn't inspect. Best-effort: cleanup
    // failure doesn't fail the update — the install the CI contract gates on
    // already succeeded.
    try {
      const { skills, scope } = await checkSkills({ dir, source });
      const removed = skills.filter((s) => s.status === "removed").map((s) => s.name);
      if (removed.length) {
        console.log();
        console.log(
          c.dim(`Removing ${removed.length} skill(s) no longer published: ${removed.join(", ")}`),
        );
        await runSkillsRemove(removed, { global: scope === "global" });
      }
    } catch (err) {
      clack.log.warn(c.warn(`Skipped removed-skill cleanup: ${(err as Error).message}`));
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
