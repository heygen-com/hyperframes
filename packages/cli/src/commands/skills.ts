import { defineCommand } from "citty";
import { execFileSync, spawn } from "node:child_process";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { buildNpxCommand } from "../utils/npxCommand.js";
import { withMeta } from "../utils/updateCheck.js";
import {
  checkSkills,
  FALLBACK_CORE_SKILLS,
  hyperframesSkillNames,
  isCoreSkill,
  presentSkills,
  pruneOrphanedLockEntries,
  SKILLS_CLI_LOCK_PATHS_VERIFIED_AT,
  type SkillDiff,
  type SkillsCheckResult,
} from "../utils/skillsManifest.js";
import { mirrorGlobalSkills } from "../utils/skillsMirror.js";
import { invalidateSkillsCache } from "../utils/skillsUpdateCheck.js";
import { trackSkillsInstallSkipped } from "../telemetry/events.js";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["Install all HyperFrames skills", "hyperframes skills"],
  ["Check whether installed skills are up to date", "hyperframes skills check"],
  ["Check, machine-readable (for agents / CI)", "hyperframes skills check --json"],
  ["Update the core set + everything already installed", "hyperframes skills update"],
  ["Also install one workflow (on-demand install)", "hyperframes skills update pr-to-video"],
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

// The upstream `skills` CLI clones the repo with `git`. When git is missing
// (common on fresh Windows boxes) the clone aborts mid-run with a noisy,
// multi-line `spawn git ENOENT` / "Installation failed" block, so detect git
// up front and skip cleanly instead of letting that surface. `git` resolves as
// a real executable on every platform, so no cmd.exe wrapping is needed.
function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", timeout: 5000 });
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
      // We install with --full-depth (a full `git clone` of the repo, the only
      // path that bypasses the laggy skills.sh blob — see GLOBAL_INSTALL_ARGS_TAIL),
      // which is heavier than the blob fetch, so allow more headroom.
      timeout: 300_000,
      cwd: opts.cwd,
      env: {
        ...process.env,
        // GH #316 — the upstream `skills` CLI shells out to `git clone`. When
        // Git's clone-hook protection is active (default in 2.45.1, reverted in
        // 2.45.2, still present on many corporate/CI setups), a globally
        // registered `git lfs install` post-checkout hook aborts the clone. The
        // args reaching this function are hardcoded (no user input), so opting
        // out is safe.
        GIT_CLONE_PROTECTION_ACTIVE: "0",
        // Skills are text; the repo's LFS objects are unrelated binary assets.
        // Skip the smudge so --full-depth doesn't drag down (or fail on) large
        // LFS blobs the install doesn't need.
        GIT_LFS_SKIP_SMUDGE: "1",
      },
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
//
// Why --copy: real files (not the upstream symlink default, which re-serialises
// each SKILL.md's frontmatter) so an installed bundle byte-matches the published
// manifest and `skills check` reads it as current. Why --full-depth: it forces a
// full `git clone` of HEAD; without it even a full-URL `skills add` fetches the
// skills.sh registry blob, which lags GitHub main by hours, so a fresh install
// would read as several skills "outdated" (verified: blob → ~9 outdated;
// --full-depth → all current).
const GLOBAL_INSTALL_ARGS_TAIL = [
  "--global",
  "--agent",
  "claude-code",
  "universal",
  "--copy",
  "--full-depth",
  "--yes",
];

/** All skills, or an explicit list of skill names to install. */
type SkillSelection = "*" | readonly string[];

// The upstream CLI takes one `--skill` flag per name (`--skill a --skill b`),
// with `'*'` meaning "all skills" — see vercel-labs/skills `add --skill`.
function skillSelectionArgs(selection: SkillSelection): string[] {
  const names = selection === "*" ? ["*"] : selection;
  return names.flatMap((name) => ["--skill", name]);
}

function runSkillsAdd(
  source: string,
  selection: SkillSelection,
  opts: { cwd?: string } = {},
): Promise<void> {
  return spawnNpx(
    ["skills", "add", source, ...skillSelectionArgs(selection), ...GLOBAL_INSTALL_ARGS_TAIL],
    opts,
  );
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

// Use the full GitHub URL (not the `owner/repo` slug) as the clone source. The
// freshness comes from --full-depth (see GLOBAL_INSTALL_ARGS_TAIL), which clones the
// repo at latest `main`; the URL just names what to clone. Our freshness check
// resolves "latest" straight from GitHub too, so install and check agree.
const SOURCES = [{ name: "HyperFrames", url: "https://github.com/heygen-com/hyperframes" }];

// Fan HyperFrames' own skills out to every other installed agent. Scope by the
// lock's source attribution (the same definition prune uses) — NOT by listing
// ~/.claude/skills, which is shared with the user's other Claude skills (gstack,
// personal, company). No-op when nothing is attributed or the global store is
// absent, so it's safe to run unconditionally after any install. Best-effort: a
// mirror failure must not fail the install.
function mirrorToInstalledAgents(): void {
  try {
    const names = hyperframesSkillNames({ scope: "global" });
    if (names.length === 0) return;
    const { mirrored } = mirrorGlobalSkills({ skills: names });
    const n = mirrored.length;
    if (n > 0) {
      console.log(
        c.dim(`Linked skills into ${n} other agent ${n === 1 ? "directory" : "directories"}.`),
      );
    }
  } catch {
    // best-effort
  }
}

// The install shells out to `npx skills add`, and that CLI clones the repo with
// git — so both must be on PATH. Each entry pairs a detector with the strict
// error (thrown so the `check || update` recovery contract fails loudly) and a
// best-effort report (one calm line; init carries on and still scaffolds).
const SKILLS_TOOLING: ReadonlyArray<{
  has: () => boolean;
  error: string;
  // Low-cardinality tag for the skip telemetry event (e.g. "git_missing").
  reason: string;
  report: () => void;
}> = [
  {
    has: hasNpx,
    error: "npx not found. Install Node.js and retry.",
    reason: "npx_missing",
    report: () => clack.log.error(c.error("npx not found. Install Node.js and retry.")),
  },
  {
    has: hasGit,
    error: "git not found. Install git and retry to add AI coding skills.",
    reason: "git_missing",
    // Skip cleanly rather than letting the upstream clone dump a noisy
    // multi-line `spawn git ENOENT` / "Installation failed" abort.
    report: () => console.log(c.dim("Skipping AI coding skills: git not available.")),
  },
];

/** True if the install can proceed; otherwise reports (or throws, when strict). */
function skillsToolingReady(strict: boolean): boolean {
  for (const tool of SKILLS_TOOLING) {
    if (tool.has()) continue;
    if (strict) throw new Error(tool.error);
    tool.report();
    // Surface the rare best-effort skip (init on a box missing git/npx); the
    // event respects the telemetry opt-out inside trackEvent.
    trackSkillsInstallSkipped({ reason: tool.reason });
    return false;
  }
  return true;
}

// Skill names can originate from a fetched manifest or agent argv, and each is
// spread into a spawn as a `--skill` value — apply the same slug guard as
// runSkillsRemove so a flag-like name can't smuggle into the command. Returns
// null when nothing valid is left to install.
function sanitizeSelection(selection: SkillSelection): SkillSelection | null {
  if (selection === "*") return selection;
  const rejected = selection.filter((n) => !PLAIN_SKILL_NAME.test(n));
  if (rejected.length) {
    clack.log.warn(c.warn(`Skipping unexpected skill name(s): ${rejected.join(", ")}`));
  }
  const safe = selection.filter((n) => PLAIN_SKILL_NAME.test(n));
  return safe.length > 0 ? safe : null;
}

async function installSkills(
  selection: SkillSelection,
  opts: { cwd?: string; strict?: boolean } = {},
): Promise<void> {
  const safeSelection = sanitizeSelection(selection);
  if (safeSelection === null) return;

  if (!skillsToolingReady(opts.strict ?? false)) return;

  for (const source of SOURCES) {
    console.log();
    console.log(c.bold(`Installing ${source.name} skills...`));
    console.log();
    try {
      await runSkillsAdd(source.url, safeSelection, opts);
    } catch (err) {
      if (opts.strict) throw err instanceof Error ? err : new Error(String(err));
      console.log(c.dim(`${source.name} skills skipped`));
    }
  }

  mirrorToInstalledAgents();
}

// ── targeted install engine ───────────────────────────────────────────────────────────────────

/** What an `updateSkills` run guaranteed, and what it had to do to get there. */
export interface UpdateSkillsResult {
  /** Every skill this run guaranteed: requested + core (+ installed, when refreshing). */
  targets: string[];
  /** Targets that were (re)installed by this run. */
  installed: string[];
  /** Targets that were already current — nothing fetched for them. */
  current: string[];
  /**
   * Requested names the latest manifest doesn't ship (typo, or renamed
   * upstream). Only ever non-empty on a non-strict run: a strict run throws on
   * unknown names before returning, so strict callers never observe this — a
   * future caller reading `unknown` should not expect it under `strict: true`.
   */
  unknown: string[];
  /** True when freshness couldn't be checked (offline) and only presence was verified. */
  presenceOnly: boolean;
}

/**
 * The targeted install engine behind `init` and `skills update [names...]` —
 * the replacement for "anything stale ⇒ re-pull the full skill set". It
 * guarantees a small, explicit set is installed and current:
 *
 *   - the requested names (a workflow being routed to, e.g. `pr-to-video`),
 *   - the core set (entry router + shared domain skills — see skillsManifest),
 *   - with `refreshInstalled`, whatever is already installed (refreshed, so an
 *     update never *expands* a deliberate partial install).
 *
 * Only targets that are actually missing or outdated are passed to
 * `skills add` (one spawn, one `--skill` flag per name); when everything is
 * current the call is a fast no-op with no install. When the manifest is
 * unreachable, freshness is unknowable and the run degrades to the presence
 * half of the guarantee — see updateSkillsOffline.
 */
export async function updateSkills(
  opts: {
    requested?: readonly string[];
    refreshInstalled?: boolean;
    strict?: boolean;
    cwd?: string;
  } = {},
): Promise<UpdateSkillsResult> {
  const requested = [...new Set(opts.requested ?? [])];
  const strict = opts.strict ?? false;

  let check: SkillsCheckResult | null = null;
  try {
    // `canonical: true` — target selection must match what `skills add`
    // actually installs from (the canonical published repo), never a local
    // checkout's `skills-manifest.json`. Without this, running from inside a
    // stale hyperframes checkout could resolve "latest" from that stale local
    // file, which may still list a skill that's since been retired/renamed
    // upstream. `isCoreSkill` would then force it into `targets`/`toInstall`,
    // `skills add` would correctly (and silently) decline to install a skill
    // that no longer exists, and verifyInstalled would strict-throw on a
    // "failure" that was never real. Resolving canonically means a retired
    // skill simply never appears as a target in the first place.
    check = await checkSkills({ cwd: opts.cwd, canonical: true });
  } catch (err) {
    // A *malformed* canonical manifest (the server was reached, but served a
    // bad shape) is otherwise indistinguishable from being offline — both fall
    // through to presence-only mode below. Surface it distinctly so ops can
    // tell an upstream/CDN problem apart from a genuine network failure.
    if (err instanceof Error && err.message.startsWith("Malformed skills manifest")) {
      clack.log.warn(
        c.warn(
          "Canonical skills manifest was malformed — falling back to presence-only mode (an upstream/CDN issue, not your network).",
        ),
      );
    }
    check = null; // manifest unreachable (offline / rate-limited) — presence mode below
  }
  if (!check) return updateSkillsOffline(requested, { strict, cwd: opts.cwd });

  // "removed" entries are lock-attributed leftovers, not manifest skills —
  // they are `skills update`'s prune concern, never an update target.
  const manifestSkills = check.skills.filter((s) => s.status !== "removed");
  const manifestNames = new Set(manifestSkills.map((s) => s.name));

  const unknown = requested.filter((name) => !manifestNames.has(name));
  if (unknown.length) {
    const message =
      `Unknown skill(s): ${unknown.join(", ")}. ` +
      `Available: ${[...manifestNames].sort().join(", ")}`;
    if (strict) throw new Error(message);
    clack.log.warn(c.warn(message));
  }

  const targets = manifestSkills.filter(
    (s) =>
      requested.includes(s.name) ||
      isCoreSkill(s.name) ||
      (opts.refreshInstalled === true && s.status !== "missing"),
  );
  const toInstall = targets.filter((s) => s.status === "missing" || s.status === "outdated");
  const result: UpdateSkillsResult = {
    targets: targets.map((s) => s.name),
    installed: toInstall.map((s) => s.name),
    current: targets.filter((s) => s.status === "current").map((s) => s.name),
    unknown,
    presenceOnly: false,
  };

  if (toInstall.length > 0) {
    await installSkills(result.installed, { cwd: opts.cwd, strict });
    verifyInstalled(result.installed, { strict, cwd: opts.cwd });
  }
  // The install (or the fresh canonical check confirming everything current)
  // supersedes whatever the background nudge cached before it — drop the
  // cached verdict so the next command re-checks instead of nagging from the
  // pre-install snapshot for up to 24h. Deliberately NOT done on the offline
  // (presence-only) path above: that run never learned anything about
  // freshness, so the cached verdict is the best information we still have.
  invalidateSkillsCache();
  return result;
}

/**
 * The presence half of the guarantee, after an install claims success: every
 * name must now exist on disk. Catches the "install exited 0 but delivered
 * nothing" failure mode, which would otherwise surface much later as a
 * workflow reading skill files that aren't there.
 *
 * Strictness mirrors the caller's tolerance: a strict run (the `check ||
 * update` CI contract, the router's trigger-time guarantee) throws so the
 * failure is loud; a non-strict run (init) only warns and proceeds, since a
 * skills hiccup must never break scaffolding.
 */
function verifyInstalled(names: readonly string[], opts: { strict: boolean; cwd?: string }): void {
  const present = new Set(presentSkills(names, { cwd: opts.cwd }));
  const absent = names.filter((name) => !present.has(name));
  if (absent.length === 0) return;
  const message = `Skill(s) still missing after install: ${absent.join(", ")}`;
  if (opts.strict) throw new Error(message);
  clack.log.warn(c.warn(message));
}

/**
 * Offline degradation for updateSkills: the manifest is unreachable, so
 * freshness is unknowable. What can still be honored is the PRESENCE half of
 * the guarantee, extended to the pinned FALLBACK_CORE_SKILLS list so the
 * router / preamble promise ("this workflow plus the core set it depends on")
 * doesn't silently shrink to just the named skill on degraded networks —
 * raw.githubusercontent.com blocked while `git clone` works is a real
 * corporate-proxy shape, which is exactly when the blind install below can
 * still succeed.
 *
 *   - Named run (`update <workflow>`): presence-check requested + fallback
 *     core, blind-install whatever is absent (a truly dead network fails the
 *     clone fast, and `strict` decides how loudly). Stale-but-present
 *     proceeds — blocking a build on a network hiccup is worse than running
 *     one release behind.
 *   - Bare run (nothing requested): the whole job was freshness, and presence
 *     can't prove it. strict — the documented `check || update` CI contract —
 *     must fail loudly rather than exit 0 while everything stays stale.
 *     Non-strict (init) still presence-checks the fallback core, so a fresh
 *     machine gets a best-effort core install instead of nothing.
 */
async function updateSkillsOffline(
  requested: readonly string[],
  opts: { strict: boolean; cwd?: string },
): Promise<UpdateSkillsResult> {
  if (requested.length === 0 && opts.strict) {
    throw new Error(
      "can't check skills freshness (GitHub manifest unreachable) — refusing to report success. Retry when online.",
    );
  }

  const targets = [...new Set([...requested, ...FALLBACK_CORE_SKILLS])];
  const present = new Set(presentSkills(targets, { cwd: opts.cwd }));
  const absent = targets.filter((name) => !present.has(name));

  console.log(
    c.dim(
      absent.length === 0
        ? "Skills freshness check unavailable (offline?) — installed skills found, continuing without a refresh."
        : `Skills freshness check unavailable (offline?) — attempting a blind install of: ${absent.join(", ")}`,
    ),
  );

  if (absent.length > 0) {
    await installSkills(absent, { cwd: opts.cwd, strict: opts.strict });
    verifyInstalled(absent, opts);
  }
  return {
    targets,
    installed: absent,
    current: [...present],
    unknown: [],
    presenceOnly: true,
  };
}

// ── check ────────────────────────────────────────────────────────────────────

/** Print a labelled list of skills (nothing if empty), each line uniformly coloured. */
function printSkillSection(
  result: SkillsCheckResult,
  status: SkillDiff["status"],
  title: string,
  mark: string,
  color: (s: string) => string,
  filter: (s: SkillDiff) => boolean = () => true,
): void {
  const items = result.skills.filter((s) => s.status === status && filter(s));
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

  const onDemandMissing = summary.missing - summary.coreMissing;
  const parts = [c.success(`✓ ${summary.current} current`)];
  if (summary.outdated) parts.push(c.warn(`↑ ${summary.outdated} outdated`));
  if (summary.coreMissing) parts.push(c.warn(`◦ ${summary.coreMissing} core not installed`));
  if (onDemandMissing) parts.push(c.dim(`◦ ${onDemandMissing} available on demand`));
  if (summary.removed) parts.push(c.warn(`✗ ${summary.removed} removed upstream`));
  console.log(`  ${parts.join("   ")}`);

  printSkillSection(result, "outdated", "Outdated:", "↑", c.warn);
  printSkillSection(
    result,
    "missing",
    "Core not installed (skills update installs these):",
    "◦",
    c.warn,
    (s) => isCoreSkill(s.name),
  );
  printSkillSection(
    result,
    "missing",
    "Available on demand (installed when their workflow first runs):",
    "◦",
    c.dim,
    (s) => !isCoreSkill(s.name),
  );
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

    // This check just displayed a fresh verdict, superseding whatever the
    // background nudge cached — invalidate so the next command's nudge agrees
    // with what the user was just shown instead of a pre-check snapshot.
    invalidateSkillsCache();

    // Exit non-zero when installed skills are stale, so agents and CI can gate:
    //   hyperframes skills check || npx hyperframes skills update
    if (result.updateAvailable) process.exitCode = 1;
  },
});

// ── update ───────────────────────────────────────────────────────────────────

/**
 * Positional skill names from argv, split into plain-slug names and rejected
 * tokens — each name is spread into a spawn as a `--skill` value, so
 * flag-like tokens are refused up front (the caller reports and exits).
 */
function requestedNamesFrom(positionals: readonly unknown[]): {
  requested: string[];
  rejected: string[];
} {
  const names = positionals.map(String).filter((n) => n.length > 0);
  return {
    requested: names.filter((n) => PLAIN_SKILL_NAME.test(n)),
    rejected: names.filter((n) => !PLAIN_SKILL_NAME.test(n)),
  };
}

/** Result line(s) for `skills update` — JSON for agents, one calm line for humans. */
function reportUpdate(
  result: UpdateSkillsResult,
  requested: readonly string[],
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(withMeta(result), null, 2));
    return;
  }
  if (result.installed.length > 0) {
    console.log(
      c.success(
        `Installed/updated ${result.installed.length} skill(s): ${result.installed.join(", ")}`,
      ),
    );
  } else if (result.presenceOnly) {
    // Freshness was never checked (offline degrade) — "up to date" would be a
    // claim we can't back. Presence is all that was verified.
    console.log(c.warn("Freshness unknown (GitHub unreachable) — verified presence only."));
  } else {
    console.log(c.success("Installed skills are already up to date."));
  }
  // The named skills are the caller's actual question ("is my workflow ready?")
  // — answer it explicitly, whatever the install had to do.
  if (requested.length) console.log(c.success(`◇ Ready: ${requested.join(", ")}`));
}

/**
 * Failure line for `skills update`. In --json mode the failure must land on
 * stdout as JSON (an agent piping to a parser gets structure, not clack
 * prose); the human path keeps the clack error.
 */
function reportUpdateFailure(message: string, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(withMeta({ error: message }), null, 2));
    return;
  }
  clack.log.error(c.error(message));
}

const updateCommand = defineCommand({
  meta: {
    name: "update",
    description:
      "Update the core set plus every installed HyperFrames skill to the latest, and remove any no longer published. Pass skill names to also install those (how workflow skills install on demand) — without names it never expands a partial install",
  },
  // Mirror `check`'s flags: the prune step runs the same removed-detection, so it
  // must respect the same overrides. Without these, `update`'s internal
  // checkSkills() fell back to defaults — pruning the auto-detected install
  // against the default manifest even when the user pointed `check` elsewhere.
  args: {
    json: { type: "boolean", description: "Output as JSON", default: false },
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

    // Positional skill names (e.g. `hyperframes skills update pr-to-video`) are
    // the ONLY way update expands an install: each named skill is guaranteed
    // present and current. This is the router's trigger-time step — the
    // /hyperframes router runs it after picking a workflow, before reading the
    // workflow's skill.
    const { requested, rejected } = requestedNamesFrom(args._ ?? []);
    if (rejected.length) {
      reportUpdateFailure(`Invalid skill name(s): ${rejected.join(", ")}`, args.json === true);
      process.exitCode = 1;
      return;
    }

    // Targeted, not full-set: refresh the core set (entry router + shared
    // domain skills) plus whatever is already installed, plus anything named
    // above. Without names a deliberate partial install stays partial
    // (refreshed, but never expanded) — the end-user workflow skills install
    // on demand, when their workflow is
    // triggered. This is where `init` and the stale-skills nudge both lead;
    // pulling the complete skill set here is exactly what users complained
    // about. Explicit full set: `hyperframes skills` or `npx skills add
    // heygen-com/hyperframes --all`.
    //
    // Note: the upstream `skills add` CLI has no `--dir` flag (it installs into
    // the resolved agent dirs), so `--dir` here scopes only the *prune* detection
    // below, not the install. `--source` likewise drives where the prune's
    // "latest" manifest comes from; the install always targets the canonical
    // HyperFrames repo so `update` reliably refreshes the published skills.
    //
    // strict: this is the documented recovery path for the agent/CI contract
    // `hyperframes skills check || hyperframes skills update`, and the router's
    // trigger-time guarantee. If the install fails (no npx, `skills add` exits
    // non-zero, a named skill still absent afterwards) it must exit non-zero
    // too — otherwise the `||` chain passes while nothing actually changed.
    try {
      const result = await updateSkills({ requested, refreshInstalled: true, strict: true });
      reportUpdate(result, requested, args.json === true);
    } catch (err) {
      reportUpdateFailure(`Update failed: ${(err as Error).message}`, args.json === true);
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
        // Self-heal: `skills remove` only clears a lock entry for a name it
        // found an on-disk bundle for (see pruneOrphanedLockEntries). A skill
        // retired before it ever shipped a bundle to this machine has none, so
        // the call above is a silent no-op for it — the lock entry lingers and
        // would be re-flagged "removed" on every future run. Prune whatever is
        // still attributed after the call so `check || update` converges
        // instead of looping forever. Best-effort and scoped to exactly the
        // lock the remove above targeted (same `scope`); a write failure here
        // must not fail the update — the install already succeeded.
        const scopeForPrune = scope ?? "global";
        const stillOrphaned = pruneOrphanedLockEntries(removed, scopeForPrune);
        if (stillOrphaned.length) {
          console.log(
            c.dim(
              `Reconciled ${stillOrphaned.length} orphaned lock entr${stillOrphaned.length === 1 ? "y" : "ies"} with no on-disk bundle: ${stillOrphaned.join(", ")}`,
            ),
          );
        }
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
    if (!args._?.[0]) {
      await installSkills("*");
      // Same as updateSkills: a full install supersedes the background
      // nudge's cached pre-install verdict.
      invalidateSkillsCache();
    }
  },
});
