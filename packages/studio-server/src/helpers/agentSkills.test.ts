import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listInstalledSkills, skillsPromptSection } from "./agentSkills";

const dirs: string[] = [];

/** An empty home, so the machine's own installed skills stay out of this. */
function emptyHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-skills-home-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(skills: string[], { root = ".claude" } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-skills-"));
  dirs.push(dir);
  for (const name of skills) {
    const path = join(dir, root, "skills", name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf-8");
  }
  return dir;
}

describe("listInstalledSkills", () => {
  it("puts the router first, whatever order they are on disk", () => {
    const dir = project(["hyperframes-core", "hyperframes", "hyperframes-animation"]);
    expect(listInstalledSkills(dir, emptyHome())).toEqual([
      "hyperframes",
      "hyperframes-animation",
      "hyperframes-core",
    ]);
  });

  it("finds them wherever the harness keeps them", () => {
    expect(listInstalledSkills(project(["hyperframes"], { root: ".agents" }), emptyHome())).toEqual(
      ["hyperframes"],
    );
    expect(listInstalledSkills(project(["hyperframes"], { root: ".codex" }), emptyHome())).toEqual([
      "hyperframes",
    ]);
  });

  it("ignores a directory with no SKILL.md, and skills that are not this framework's", () => {
    const dir = project(["hyperframes-core"]);
    mkdirSync(join(dir, ".claude", "skills", "hyperframes-empty"), { recursive: true });
    mkdirSync(join(dir, ".claude", "skills", "vocabulary"), { recursive: true });
    writeFileSync(join(dir, ".claude", "skills", "vocabulary", "SKILL.md"), "x", "utf-8");
    expect(listInstalledSkills(dir, emptyHome())).toEqual(["hyperframes-core"]);
  });
});

describe("skillsPromptSection", () => {
  it("says nothing when the project has no skills — an agent cannot load what is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-skills-none-"));
    dirs.push(dir);
    expect(skillsPromptSection(dir, emptyHome())).toEqual([]);
  });

  it("leads with the router and names the Studio skill when it is there", () => {
    const text = skillsPromptSection(
      project(["hyperframes", "hyperframes-studio"]),
      emptyHome(),
    ).join("\n");
    expect(text).toContain("/hyperframes first");
    expect(text).toContain("/hyperframes-studio");
  });

  it("lists the rest so the agent knows what it can reach for", () => {
    const text = skillsPromptSection(
      project(["hyperframes", "hyperframes-keyframes"]),
      emptyHome(),
    ).join("\n");
    expect(text).toContain("/hyperframes-keyframes");
  });
});
