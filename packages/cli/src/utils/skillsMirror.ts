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
// only for agents the machine actually has (their marker dir exists). On Unix
// each skill is a relative symlink back into the store (one source of truth,
// near-zero size, auto-fresh on update); on Windows it's a copy, because
// symlinks there need admin / Developer Mode and otherwise silently dangle —
// the same fallback the upstream `skills` CLI and gstack both make.
//
// Agent dirs are resolved through the same env-overridable base dirs upstream
// uses (XDG_CONFIG_HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, …), so a machine with
// those set mirrors into the exact dir the agent reads.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { AGENT_GLOBAL_DIRS, type AgentDirBase } from "./agentDirs.generated.js";

export interface MirrorResult {
  /** The store mirrored from, or null when no global Claude store was found. */
  source: string | null;
  /** Agents whose global dir was (re)populated. */
  mirrored: { agent: string; dir: string }[];
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
function linkOrCopy(sourceSkill: string, targetSkill: string, platform: NodeJS.Platform): void {
  rmSync(targetSkill, { recursive: true, force: true });
  if (platform === "win32") {
    cpSync(sourceSkill, targetSkill, { recursive: true });
  } else {
    symlinkSync(relative(dirname(targetSkill), sourceSkill), targetSkill);
  }
}

/**
 * Populate one agent's global dir from the store. Best-effort and idempotent;
 * per-skill failures don't abort the others. Returns false if the dir couldn't
 * be created at all.
 */
function mirrorInto(
  targetDir: string,
  source: string,
  skills: string[],
  platform: NodeJS.Platform,
): boolean {
  try {
    mkdirSync(targetDir, { recursive: true });
  } catch {
    return false;
  }
  for (const skill of skills) {
    try {
      linkOrCopy(join(source, skill), join(targetDir, skill), platform);
    } catch {
      // best-effort per skill
    }
  }
  return true;
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
  if (!existsSync(source)) return { source: null, mirrored: [] };

  // Mirror ONLY HyperFrames' own skills (by name), NEVER everything in the
  // store: ~/.claude/skills is shared, so a user's gstack / personal / company
  // skills live there too and must not be fanned out to (or overwrite) other
  // agents. `opts.skills` is the lock-attributed HyperFrames set (see
  // hyperframesSkillNames).
  const allowed = new Set(opts.skills);
  const skills = listSkillDirs(source).filter((name) => allowed.has(name));
  if (skills.length === 0) return { source, mirrored: [] };

  const mirrored: { agent: string; dir: string }[] = [];
  for (const { agent, base, sub } of AGENT_GLOBAL_DIRS) {
    const targetDir = join(bases[base], ...sub.split("/").filter(Boolean));
    if (targetDir === source || targetDir === universalStore) continue; // install-owned
    if (!existsSync(dirname(targetDir))) continue; // agent not installed (no marker)
    if (mirrorInto(targetDir, source, skills, platform)) mirrored.push({ agent, dir: targetDir });
  }
  return { source, mirrored };
}
