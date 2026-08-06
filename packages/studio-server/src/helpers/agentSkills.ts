import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Which HyperFrames skills the spawned agent can load.
 *
 * A generic coding agent writes generic HTML. The skills are what carry the
 * framework's own rules — the `data-*` timing contract, seek-safe animation,
 * determinism — so a run that loads them produces a composition that renders,
 * and a run that does not produces something that looks right in a browser and
 * breaks under the renderer.
 *
 * Studio reports what is actually installed rather than telling every agent to
 * load skills that may not be there: an instruction to open a missing skill is
 * a wasted turn and an error message. The list is read from disk, so a skill
 * installed after Studio started shows up on the next run.
 */

/**
 * Where the harnesses look for skills, project-local first. `home` is a
 * parameter so a test can point it at an empty directory: read from the real
 * one, the result would depend on whatever the machine happens to have.
 */
function skillRoots(projectDir: string, home: string): string[] {
  return [
    join(projectDir, ".claude", "skills"),
    join(projectDir, ".agents", "skills"),
    join(projectDir, ".codex", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".codex", "skills"),
  ];
}

/** The entry skill: the router every other HyperFrames skill hangs off. */
const ENTRY_SKILL = "hyperframes";

/**
 * Installed HyperFrames skills, entry skill first.
 *
 * Only this framework's own skills are listed — the roots also hold whatever
 * else the user has installed, and naming those in an edit prompt would be
 * noise. The entry skill routes to the rest, including the ones not named here.
 */
export function listInstalledSkills(projectDir: string, home = homedir()): string[] {
  const found = new Set<string>();
  for (const root of skillRoots(projectDir, home)) {
    if (!existsSync(root)) continue;
    try {
      for (const name of readdirSync(root)) {
        if (!name.startsWith(ENTRY_SKILL)) continue;
        if (!existsSync(join(root, name, "SKILL.md"))) continue;
        if (statSync(join(root, name)).isDirectory()) found.add(name);
      }
    } catch {
      // An unreadable skills directory just means Studio says nothing about it.
    }
  }

  const names = [...found].sort();
  return names.includes(ENTRY_SKILL)
    ? [ENTRY_SKILL, ...names.filter((name) => name !== ENTRY_SKILL)]
    : names;
}

/**
 * The lines appended to an edit prompt naming those skills, or none when the
 * project has none installed.
 */
export function skillsPromptSection(projectDir: string, home = homedir()): string[] {
  const skills = listInstalledSkills(projectDir, home);
  if (skills.length === 0) return [];

  const studio = skills.includes("hyperframes-studio");
  return [
    "",
    "Skills installed here — load them before editing:",
    `- /${skills[0]} first. It is the capability map and router; it names the skill for whatever this change turns out to need.`,
    ...(studio
      ? [
          "- /hyperframes-studio for working inside Studio: the request format above, and how to say what you are doing on the canvas.",
        ]
      : []),
    ...(skills.length > (studio ? 2 : 1)
      ? [
          `- Also installed: ${skills
            .filter((name) => name !== skills[0] && name !== "hyperframes-studio")
            .map((name) => `/${name}`)
            .join(", ")}.`,
        ]
      : []),
    "- They carry the framework rules a generic edit misses: the data-* timing contract, seek-safe motion, and determinism (no Date.now, no unseeded random, no render-time fetches).",
  ];
}
