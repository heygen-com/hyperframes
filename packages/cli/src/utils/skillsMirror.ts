// Fan the canonical global skills store out to every OTHER installed agent.
//
// `skills add --global --agent claude-code universal --copy` writes REAL files
// to two global stores: the Claude store (~/.claude/skills — what Claude Code
// reads, at global priority) and the shared universal store (~/.agents/skills,
// which Cursor/Codex/… read in PROJECT scope and the .agents-family agents read
// globally). But every other agent reads its OWN global dir (~/.cursor/skills,
// goose → ~/.config/goose/skills, …), which upstream's --global does NOT
// populate.
//
// So we mirror the canonical Claude store into each of those per-agent dirs, but
// only for agents the machine actually has (their marker dir exists). Agents
// that already consume the universal ~/.agents/skills store globally (Pi) are
// skipped: their universal copy is authoritative and a per-agent copy would
// collide with it (#3294). On Unix
// each skill is a relative symlink back into the store (one source of truth,
// near-zero size, auto-fresh on update); on Windows it's a copy, because
// symlinks there need admin / Developer Mode and otherwise silently dangle —
// the same fallback the upstream `skills` CLI and gstack both make.
//
// Agent dirs are resolved through the same env-overridable base dirs upstream
// uses (XDG_CONFIG_HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, …), so a machine with
// those set mirrors into the exact dir the agent reads.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AGENT_GLOBAL_DIRS, type AgentDirBase } from "./agentDirs.generated.js";

/**
 * Agents that natively discover the universal `~/.agents/skills` store globally
 * in ADDITION to their own agent-specific directory. Mirroring into their own
 * dir makes every skill discoverable twice.
 *
 * Pi is the known case (earendil-works/pi): it reads both `~/.pi/agent/skills/`
 * and `~/.agents/skills/` as global locations (pi's packages/coding-agent/docs/
 * skills.md#locations), so a mirrored entry collides with the universal copy
 * and Pi skips the universal one on name conflict (#3294).
 *
 * The generated table cannot carry this capability — it is a plain
 * (agent, base, sub) list synced from vercel-labs/skills — so the set lives
 * here next to the mirror logic that needs it.
 */
const UNIVERSAL_STORE_READERS = new Set(["pi"]);

export interface MirrorResult {
  /** The store mirrored from, or null when no global Claude store was found. */
  source: string | null;
  /** Agents whose global dir was (re)populated. */
  mirrored: { agent: string; dir: string }[];
  /** Agent targets skipped because their filesystem identity was unsafe. */
  skipped: {
    agent: string;
    dir: string;
    reason: "aliases_install_owned_store" | "unresolvable_target";
  }[];
}

type MirrorSkipReason = MirrorResult["skipped"][number]["reason"];

/** Resolve a path through existing ancestors without creating its missing tail. */
function canonicalCandidate(input: string): string | null {
  let current = resolve(input);
  const missing: string[] = [];
  while (true) {
    try {
      lstatSync(current);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
      const parent = dirname(current);
      if (parent === current) return null;
      missing.unshift(basename(current));
      current = parent;
    }
  }
  try {
    return resolve(realpathSync(current), ...missing);
  } catch {
    return null;
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const fromLeft = relative(left, right);
  const leftContainsRight =
    fromLeft === "" ||
    (fromLeft !== ".." && !fromLeft.startsWith(`..${sep}`) && !isAbsolute(fromLeft));
  if (leftContainsRight) return true;
  const fromRight = relative(right, left);
  return fromRight !== ".." && !fromRight.startsWith(`..${sep}`) && !isAbsolute(fromRight);
}

function sameExistingNode(left: string, right: string): boolean {
  try {
    const leftStat = statSync(left);
    const rightStat = statSync(right);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch {
    return false;
  }
}

function targetSafety(
  target: string,
  protectedPaths: ReadonlyArray<{ lexical: string; canonical: string }>,
): MirrorSkipReason | null {
  const canonical = canonicalCandidate(target);
  if (!canonical) return "unresolvable_target";
  for (const protectedPath of protectedPaths) {
    if (
      pathsOverlap(canonical, protectedPath.canonical) ||
      sameExistingNode(target, protectedPath.lexical)
    ) {
      return "aliases_install_owned_store";
    }
  }
  return null;
}

function skillTargetSafety(
  sourceSkill: string,
  targetSkill: string,
  targetDirSafety: () => MirrorSkipReason | null,
): MirrorSkipReason | null {
  const directoryReason = targetDirSafety();
  if (directoryReason) return directoryReason;
  try {
    // A final symlink is the normal Unix mirror shape. rmSync unlinks it
    // without traversing its target, so canonical equality is safe here.
    if (lstatSync(targetSkill).isSymbolicLink()) return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "unresolvable_target";
  }
  const sourceCanonical = canonicalCandidate(sourceSkill);
  const targetCanonical = canonicalCandidate(targetSkill);
  if (!sourceCanonical || !targetCanonical) return "unresolvable_target";
  if (
    pathsOverlap(sourceCanonical, targetCanonical) ||
    sameExistingNode(sourceSkill, targetSkill)
  ) {
    return "aliases_install_owned_store";
  }
  return null;
}

/** Resolve each env-overridable base dir exactly as upstream agents.ts does. */
function resolveBases(home: string, env: NodeJS.ProcessEnv): Record<AgentDirBase, string> {
  const xdg = env["XDG_CONFIG_HOME"]?.trim();
  return {
    home,
    configHome: xdg && isAbsolute(xdg) ? xdg : join(home, ".config"),
    codexHome: env["CODEX_HOME"]?.trim() || join(home, ".codex"),
    claudeHome: env["CLAUDE_CONFIG_DIR"]?.trim() || join(home, ".claude"),
    vibeHome: env["VIBE_HOME"]?.trim() || join(home, ".vibe"),
    hermesHome: env["HERMES_HOME"]?.trim() || join(home, ".hermes"),
    autohandHome: env["AUTOHAND_HOME"]?.trim() || join(home, ".autohand"),
  };
}

/** Skill bundle names directly under a store (a dir/symlink with a SKILL.md). */
function listSkillDirs(store: string): string[] {
  return readdirSync(store, { withFileTypes: true })
    .filter(
      (e) => (e.isDirectory() || e.isSymbolicLink()) && existsSync(join(store, e.name, "SKILL.md")),
    )
    .map((e) => e.name);
}

/**
 * Point `targetSkill` at `sourceSkill`. Any prior entry (our symlink, a stale
 * copy, or a previous install) is removed first so the mirror always reflects
 * the canonical store — that's the whole point of "update".
 */
function linkOrCopy(
  sourceSkill: string,
  targetSkill: string,
  platform: NodeJS.Platform,
  safety: () => MirrorSkipReason | null,
): MirrorSkipReason | null {
  const unsafe = safety();
  if (unsafe) return unsafe;
  rmSync(targetSkill, { recursive: true, force: true });
  if (platform === "win32") {
    cpSync(sourceSkill, targetSkill, { recursive: true });
  } else {
    symlinkSync(relative(dirname(targetSkill), sourceSkill), targetSkill);
  }
  return null;
}

/**
 * Populate one agent's global dir from the store. Best-effort and idempotent;
 * per-skill failures don't abort the others. Unsafe target identity stops the
 * agent before the next destructive operation and returns a reportable reason.
 */
function mirrorInto(
  targetDir: string,
  source: string,
  skills: string[],
  platform: NodeJS.Platform,
  safety: () => MirrorSkipReason | null,
): { mirrored: boolean; skipReason?: MirrorSkipReason } {
  const beforeCreate = safety();
  if (beforeCreate) return { mirrored: false, skipReason: beforeCreate };
  try {
    mkdirSync(targetDir, { recursive: true });
  } catch {
    return { mirrored: false };
  }
  const afterCreate = safety();
  if (afterCreate) return { mirrored: false, skipReason: afterCreate };
  for (const skill of skills) {
    try {
      const sourceSkill = join(source, skill);
      const targetSkill = join(targetDir, skill);
      const skipReason = linkOrCopy(sourceSkill, targetSkill, platform, () =>
        skillTargetSafety(sourceSkill, targetSkill, safety),
      );
      if (skipReason) return { mirrored: false, skipReason };
    } catch {
      // best-effort per skill
    }
  }
  return { mirrored: true };
}

/**
 * Mirror the global Claude store into every installed agent's global skills
 * dir. Best-effort and idempotent: a no-op when the store is absent, and per
 * skill failures (permissions, races) don't abort the rest.
 */
export function mirrorGlobalSkills(opts: {
  skills: readonly string[];
  home?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}): MirrorResult {
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? process.platform;
  const bases = resolveBases(home, opts.env ?? process.env);

  // The two stores the global --copy install writes as real files. The mirror
  // reads from the Claude store and must never link/copy onto either of them.
  const source = join(bases.claudeHome, "skills");
  const universalStore = join(home, ".agents", "skills");
  if (!existsSync(source)) return { source: null, mirrored: [], skipped: [] };

  // Mirror ONLY HyperFrames' own skills (by name), NEVER everything in the
  // store: ~/.claude/skills is shared, so a user's gstack / personal / company
  // skills live there too and must not be fanned out to (or overwrite) other
  // agents. `opts.skills` is the lock-attributed HyperFrames set (see
  // hyperframesSkillNames).
  const allowed = new Set(opts.skills);
  const skills = listSkillDirs(source).filter((name) => allowed.has(name));
  if (skills.length === 0) return { source, mirrored: [], skipped: [] };

  const protectedPaths = [source, universalStore].map((lexical) => ({
    lexical,
    canonical: canonicalCandidate(lexical),
  }));
  const resolvedProtectedPaths = protectedPaths.filter(
    (entry): entry is { lexical: string; canonical: string } => entry.canonical !== null,
  );
  if (resolvedProtectedPaths.length !== protectedPaths.length) {
    return { source, mirrored: [], skipped: [] };
  }

  const mirrored: { agent: string; dir: string }[] = [];
  const skipped: MirrorResult["skipped"] = [];
  for (const { agent, base, sub } of AGENT_GLOBAL_DIRS) {
    const targetDir = join(bases[base], ...sub.split("/").filter(Boolean));
    if (targetDir === source || targetDir === universalStore) continue; // install-owned
    if (UNIVERSAL_STORE_READERS.has(agent)) continue; // already reads the universal store (#3294)
    if (!existsSync(dirname(targetDir))) continue; // agent not installed (no marker)
    const attempt = mirrorInto(targetDir, source, skills, platform, () =>
      targetSafety(targetDir, resolvedProtectedPaths),
    );
    if (attempt.mirrored) mirrored.push({ agent, dir: targetDir });
    else if (attempt.skipReason)
      skipped.push({ agent, dir: targetDir, reason: attempt.skipReason });
  }
  return { source, mirrored, skipped };
}
