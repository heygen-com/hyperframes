import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashSkillBundle,
  buildManifest,
  diffSkills,
  type SkillsManifest,
  type SkillEntry,
} from "./skillsManifest.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skills-manifest-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSkill(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

describe("hashSkillBundle", () => {
  it("is deterministic for identical content", () => {
    const a = writeSkill("a", { "SKILL.md": "hello", "references/x.md": "x" });
    const b = writeSkill("b", { "SKILL.md": "hello", "references/x.md": "x" });
    expect(hashSkillBundle(a).hash).toBe(hashSkillBundle(b).hash);
  });

  it("changes when any file's content changes", () => {
    const dir = writeSkill("a", { "SKILL.md": "hello", "references/x.md": "x" });
    const before = hashSkillBundle(dir).hash;
    writeFileSync(join(dir, "references/x.md"), "CHANGED");
    expect(hashSkillBundle(dir).hash).not.toBe(before);
  });

  it("counts every file in the bundle, not just SKILL.md", () => {
    const dir = writeSkill("a", {
      "SKILL.md": "hello",
      "references/x.md": "x",
      "scripts/y.mjs": "export const y = 1;",
    });
    expect(hashSkillBundle(dir).files).toBe(3);
  });

  it("normalises CRLF so a Windows checkout is not flagged as different", () => {
    const lf = writeSkill("lf", { "SKILL.md": "line1\nline2\n" });
    const crlf = writeSkill("crlf", { "SKILL.md": "line1\r\nline2\r\n" });
    expect(hashSkillBundle(lf).hash).toBe(hashSkillBundle(crlf).hash);
  });
});

describe("buildManifest", () => {
  it("includes only directories that contain a SKILL.md", () => {
    writeSkill("real", { "SKILL.md": "x" });
    writeSkill("not-a-skill", { "README.md": "x" });
    const m = buildManifest(root, { source: "test" });
    expect(Object.keys(m.skills)).toEqual(["real"]);
  });
});

describe("diffSkills", () => {
  const latest: SkillsManifest = {
    source: "test",
    skills: {
      keep: { hash: "h1", files: 1 },
      changed: { hash: "h2", files: 1 },
      gone: { hash: "h3", files: 1 },
    },
  };

  it("classifies current / outdated / missing and ignores skills not in the manifest", () => {
    const installed: Record<string, SkillEntry> = {
      keep: { hash: "h1", files: 1 }, // current
      changed: { hash: "DIFFERENT", files: 1 }, // outdated
      // gone: not installed → missing
      extra: { hash: "hx", files: 1 }, // not in the manifest → ignored
    };
    const diff = diffSkills(installed, latest);
    const byName = Object.fromEntries(diff.skills.map((s) => [s.name, s.status]));
    expect(byName).toEqual({
      keep: "current",
      changed: "outdated",
      gone: "missing",
    });
    expect(diff.summary).toEqual({ current: 1, outdated: 1, missing: 1 });
  });

  it("flags updateAvailable when a skill is outdated OR missing", () => {
    // The full set is the goal, so missing skills now count too.
    const missingOnly = diffSkills({ keep: { hash: "h1", files: 1 } }, latest);
    expect(missingOnly.updateAvailable).toBe(true);

    const hasOutdated = diffSkills({ changed: { hash: "X", files: 1 } }, latest);
    expect(hasOutdated.updateAvailable).toBe(true);

    // Everything present and current → no update.
    const allCurrent = diffSkills(
      {
        keep: { hash: "h1", files: 1 },
        changed: { hash: "h2", files: 1 },
        gone: { hash: "h3", files: 1 },
      },
      latest,
    );
    expect(allCurrent.updateAvailable).toBe(false);

    // A skill installed but not in the manifest is ignored — doesn't trigger one.
    const withExtra = diffSkills(
      {
        keep: { hash: "h1", files: 1 },
        changed: { hash: "h2", files: 1 },
        gone: { hash: "h3", files: 1 },
        extra: { hash: "hx", files: 1 },
      },
      latest,
    );
    expect(withExtra.updateAvailable).toBe(false);
  });
});
