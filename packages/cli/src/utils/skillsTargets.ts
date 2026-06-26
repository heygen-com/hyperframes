// Decide WHICH agents a `skills add` should install to, so HyperFrames never
// sprays its skills into every one of the ~70 agent conventions the upstream
// `skills` CLI knows about (its `--all` is shorthand for `--agent '*'`).
//
// The policy, in priority order:
//   1. If the project already has agent skill folders (`.claude/skills`,
//      `.hermes/skills`, …), install ONLY to those. An existing folder is the
//      strongest signal of intent — honour it exactly, add nothing else.
//   2. Otherwise (blank project), pick targets from the machine:
//      2a. Running under Claude Code (`CLAUDECODE`) → just claude-code.
//      2b. Else probe the PATH for installed agent CLIs (the gstack approach:
//          an executable on PATH means that agent is actually installed here).
//      2c. Else fall back to the floor: claude-code + the shared `.agents`
//          universal dir (which Cursor, Codex, OpenCode, Gemini, Copilot and a
//          dozen others read from in project scope).
//
// All paths are PROJECT-scoped (the default for `skills add` without `--global`),
// which is why the dir map below is the project-scope layout.

import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Project-scope host directory → the upstream `skills` `--agent` key that
 * installs into it. The dir name deliberately differs from the key for several
 * agents (`.factory` ↔ `droid`, `.hermes` ↔ `hermes-agent`), and many agents
 * share the `.agents` universal dir, so the mapping is explicit rather than
 * derived. Keys verified against vercel-labs/skills@v1.5.13.
 */
const DIR_TO_KEY: Readonly<Record<string, string>> = {
  ".claude": "claude-code",
  ".agents": "universal",
  ".hermes": "hermes-agent",
  ".factory": "droid",
  ".kiro": "kiro-cli",
};

/**
 * Agent CLIs we probe for on PATH, paired with the project-scope host dir each
 * installs into. Several (Cursor, Codex, OpenCode, Gemini) share `.agents`, so
 * detecting any of them resolves — via DIR_TO_KEY — to the single `universal`
 * key and one write to `.agents/skills`. OpenClaw is intentionally absent: its
 * project skills dir is a bare `skills/`, which collides with common project
 * layouts, so we never auto-target it (an existing folder or explicit `--agent`
 * still works upstream).
 */
const DETECTABLE: ReadonlyArray<{ bin: string; dir: string }> = [
  { bin: "claude", dir: ".claude" },
  { bin: "hermes", dir: ".hermes" },
  { bin: "droid", dir: ".factory" },
  { bin: "cursor", dir: ".agents" },
  { bin: "codex", dir: ".agents" },
  { bin: "opencode", dir: ".agents" },
  { bin: "gemini", dir: ".agents" },
];

export interface ResolveTargetsInput {
  /** Project root the install targets (cwd, or the init destination). */
  cwd: string;
  /** Process env — read for the `CLAUDECODE` signal. */
  env: NodeJS.ProcessEnv;
  /** PATH string for the on-PATH binary probe. */
  pathStr: string;
  /** Platform — selects the executable extensions probed on Windows. */
  platform: NodeJS.Platform;
}

export interface ResolvedTargets {
  /** Upstream `--agent` keys to install to (never `'*'`). */
  agents: string[];
  /** Short human-readable explanation of why these were chosen. */
  reason: string;
}

function isDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True if `bin` resolves on any PATH entry (Windows also tries .exe/.cmd/.bat). */
function isOnPath(bin: string, pathStr: string, platform: NodeJS.Platform): boolean {
  const exts = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathStr.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (existsSync(join(dir, bin + ext))) return true;
      } catch {
        // Unreadable PATH entry — skip it.
      }
    }
  }
  return false;
}

/** Map a set of host dirs to deduped `--agent` keys, claude-code first (DIR_TO_KEY order). */
function keysForDirs(dirs: ReadonlySet<string>): string[] {
  return Object.entries(DIR_TO_KEY)
    .filter(([dir]) => dirs.has(dir))
    .map(([, key]) => key);
}

/** Agent skill folders that already exist under the project root. */
function existingProjectAgents(cwd: string): string[] {
  const dirs = new Set<string>();
  for (const dir of Object.keys(DIR_TO_KEY)) {
    if (isDir(join(cwd, dir, "skills"))) dirs.add(dir);
  }
  return keysForDirs(dirs);
}

/** Agent CLIs installed on this machine (by PATH probe), as `--agent` keys. */
function detectInstalledAgents(pathStr: string, platform: NodeJS.Platform): string[] {
  const dirs = new Set<string>();
  for (const { bin, dir } of DETECTABLE) {
    if (isOnPath(bin, pathStr, platform)) dirs.add(dir);
  }
  return keysForDirs(dirs);
}

/**
 * Resolve the `--agent` targets for an install. See the file header for the
 * full policy. Pure: all inputs are passed in, so it is fully unit-testable.
 */
export function resolveAgentTargets(input: ResolveTargetsInput): ResolvedTargets {
  // 1. Honour what the project already has — nothing more.
  const existing = existingProjectAgents(input.cwd);
  if (existing.length > 0) {
    return { agents: existing, reason: `existing project skill folders (${existing.join(", ")})` };
  }

  // 2a. Strongest live signal: the agent running this command.
  if (input.env["CLAUDECODE"]) {
    return { agents: ["claude-code"], reason: "running under Claude Code" };
  }

  // 2b. gstack approach: agent CLIs actually installed on this machine.
  const detected = detectInstalledAgents(input.pathStr, input.platform);
  if (detected.length > 0) {
    return { agents: detected, reason: `installed agent CLIs (${detected.join(", ")})` };
  }

  // 2c. Floor: Claude Code + the shared `.agents` universal dir. Never `--agent '*'`.
  return { agents: ["claude-code", "universal"], reason: "default (.claude + .agents)" };
}

/**
 * Build the `skills add` arguments for a resolved target set: every skill
 * (`--skill '*'`) to the chosen agents only, non-interactive. This replaces the
 * upstream `--all` (= `--skill '*' --agent '*' -y`) so the agent fan-out is
 * scoped instead of universal.
 */
export function buildSkillsAddArgs(agents: string[]): string[] {
  return ["--skill", "*", "--agent", ...agents, "--yes"];
}
