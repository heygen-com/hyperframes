import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashSkillBundle,
  buildManifest,
  checkSkills,
  diffSkills,
  FALLBACK_CORE_SKILLS,
  isCoreSkill,
  presentSkills,
  skillsAttributedToSource,
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

describe("isCoreSkill", () => {
  it("classifies the entry router, hyperframes-* domain skills, and media-use as core", () => {
    expect(isCoreSkill("hyperframes")).toBe(true);
    expect(isCoreSkill("hyperframes-core")).toBe(true);
    expect(isCoreSkill("hyperframes-animation")).toBe(true);
    expect(isCoreSkill("media-use")).toBe(true);
    // End-user workflows and optional integrations install on demand.
    expect(isCoreSkill("pr-to-video")).toBe(false);
    expect(isCoreSkill("embedded-captions")).toBe(false);
    expect(isCoreSkill("figma")).toBe(false);
  });
});

describe("FALLBACK_CORE_SKILLS pin", () => {
  // The fallback list exists because isCoreSkill is a pattern and the offline
  // path can't enumerate a pattern. This pins the list to the repo's actual
  // skills/ tree so it can't drift silently when core membership changes.
  it("matches the core skills present in the repo's skills/ tree exactly", () => {
    const skillsRoot = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "skills",
    );
    const onDisk = readdirSync(skillsRoot).filter((n) =>
      existsSync(join(skillsRoot, n, "SKILL.md")),
    );
    const coreOnDisk = onDisk.filter((n) => isCoreSkill(n)).sort();
    expect([...FALLBACK_CORE_SKILLS].sort()).toEqual(coreOnDisk);
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
    expect(diff.summary).toEqual({ current: 1, outdated: 1, missing: 1, coreMissing: 0 });
  });

  it("flags updateAvailable for anything outdated", () => {
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

  it("a missing on-demand skill is NOT an update — a missing core skill is", () => {
    // The old semantics ("full set is the goal") made any missing skill flip
    // updateAvailable, which re-pulled all skills onto deliberate partial
    // installs. On-demand skills now install when their workflow triggers.
    const withCore: SkillsManifest = {
      source: "test",
      skills: {
        hyperframes: { hash: "e1", files: 1 }, // core: entry router
        "pr-to-video": { hash: "w1", files: 1 }, // on-demand workflow
      },
    };

    // Core current, workflow missing → partial install is fine, no update.
    const workflowMissing = diffSkills({ hyperframes: { hash: "e1", files: 1 } }, withCore);
    expect(workflowMissing.updateAvailable).toBe(false);
    expect(workflowMissing.summary).toEqual({
      current: 1,
      outdated: 0,
      missing: 1,
      coreMissing: 0,
    });

    // Core itself missing → every workflow needs it, so that IS an update.
    const coreMissing = diffSkills({ "pr-to-video": { hash: "w1", files: 1 } }, withCore);
    expect(coreMissing.updateAvailable).toBe(true);
    expect(coreMissing.summary).toEqual({ current: 1, outdated: 0, missing: 1, coreMissing: 1 });
  });
});

describe("presentSkills", () => {
  it("returns only the names present in the located install", () => {
    const home = join(root, "home");
    const project = join(root, "project");
    mkdirSync(project, { recursive: true });
    const skillsDir = join(home, ".claude/skills");
    mkdirSync(join(skillsDir, "hyperframes"), { recursive: true });
    writeFileSync(join(skillsDir, "hyperframes", "SKILL.md"), "# hyperframes");

    expect(presentSkills(["hyperframes", "pr-to-video"], { cwd: project, home })).toEqual([
      "hyperframes",
    ]);
  });

  it("returns [] when no install exists at all", () => {
    const home = join(root, "home");
    const project = join(root, "project");
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    expect(presentSkills(["hyperframes"], { cwd: project, home })).toEqual([]);
  });
});

describe("checkSkills install detection", () => {
  // A spread of agent-host conventions across the upstream `skills` universe,
  // including the XDG-nested OpenCode layout. Detection is structural
  // (auto-discovered), so this list is illustrative, not exhaustive.
  const CASES: ReadonlyArray<[string, string]> = [
    [".claude/skills", "claude-code"],
    [".agents/skills", "agents"],
    [".codex/skills", "codex"],
    [".cursor/skills", "cursor"],
    [".config/opencode/skills", "opencode"],
    [".factory/skills", "factory"],
    [".slate/skills", "slate"],
    [".kiro/skills", "kiro"],
    [".hermes/skills", "hermes"],
    [".gbrain/skills", "gbrain"],
    [".openclaw/skills", "openclaw"],
  ];

  function writeManifest(dir: string): string {
    const p = join(dir, "manifest.json");
    writeFileSync(
      p,
      JSON.stringify({
        source: "test",
        skills: { alpha: { hash: "x", files: 1 }, beta: { hash: "y", files: 1 } },
      }),
    );
    return p;
  }

  function installSkill(skillsDir: string, name: string): void {
    mkdirSync(join(skillsDir, name), { recursive: true });
    writeFileSync(join(skillsDir, name, "SKILL.md"), `# ${name}`);
  }

  it.each(CASES)("locates skills under %s in the project scope", async (rel, agent) => {
    const project = join(root, "project");
    const home = join(root, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });
    const source = writeManifest(root);
    installSkill(join(project, rel), "alpha");

    const res = await checkSkills({ source, cwd: project, home });
    expect(res.location).toBe(join(project, rel));
    expect(res.agent).toBe(agent);
  });

  it.each(CASES)("locates skills under %s in the global scope", async (rel, agent) => {
    const project = join(root, "project");
    const home = join(root, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });
    const source = writeManifest(root);
    installSkill(join(home, rel), "alpha");

    const res = await checkSkills({ source, cwd: project, home });
    expect(res.location).toBe(join(home, rel));
    expect(res.agent).toBe(agent);
  });

  it("prefers global scope over project (matches how agents load skills)", async () => {
    const project = join(root, "project");
    const home = join(root, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });
    const source = writeManifest(root);
    installSkill(join(home, ".claude/skills"), "alpha"); // global — what the agent actually loads
    installSkill(join(project, ".hermes/skills"), "alpha"); // project — overridden by the global copy

    // Claude Code (and most agents) give the personal/global scope priority over
    // the project scope, and HyperFrames installs globally — so check reports on
    // the global copy the agent will really use, not a stale project copy.
    const res = await checkSkills({ source, cwd: project, home });
    expect(res.location).toBe(join(home, ".claude/skills"));
    expect(res.agent).toBe("claude-code");
  });

  it("reports no location and an available update when nothing is installed", async () => {
    const project = join(root, "project");
    const home = join(root, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });
    // A manifest with a core skill: a truly fresh machine is missing the core
    // set, and THAT (not the missing on-demand skills) makes the update
    // available.
    const source = join(root, "manifest-core.json");
    writeFileSync(
      source,
      JSON.stringify({
        source: "test",
        skills: { hyperframes: { hash: "x", files: 1 }, alpha: { hash: "y", files: 1 } },
      }),
    );

    const res = await checkSkills({ source, cwd: project, home });
    expect(res.location).toBeNull();
    expect(res.summary.missing).toBe(2);
    expect(res.summary.coreMissing).toBe(1);
    expect(res.updateAvailable).toBe(true);
  });

  it("honors the --dir override and infers the agent from the path", async () => {
    const dir = join(root, "home", ".kiro/skills");
    installSkill(dir, "alpha");
    const source = writeManifest(root);

    const res = await checkSkills({ source, dir });
    expect(res.location).toBe(dir);
    expect(res.agent).toBe("kiro");
  });

  it("auto-discovers an unknown/new agent host (no closed list)", async () => {
    const project = join(root, "project");
    const home = join(root, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });
    const source = writeManifest(root);
    // A host this CLI has never heard of — structural discovery still finds it.
    installSkill(join(home, ".some-future-agent/skills"), "alpha");

    const res = await checkSkills({ source, cwd: project, home });
    expect(res.location).toBe(join(home, ".some-future-agent/skills"));
    expect(res.agent).toBe("some-future-agent");
  });

  it("prefers claude-code when multiple hosts in the same scope have skills", async () => {
    const project = join(root, "project");
    const home = join(root, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });
    const source = writeManifest(root);
    installSkill(join(home, ".factory/skills"), "alpha");
    installSkill(join(home, ".claude/skills"), "alpha");

    const res = await checkSkills({ source, cwd: project, home });
    expect(res.location).toBe(join(home, ".claude/skills"));
    expect(res.agent).toBe("claude-code");
  });
});

describe("skillsAttributedToSource", () => {
  it("matches by slug or git clone URL and ignores other sources", () => {
    const lock = {
      skills: {
        a: { source: "heygen-com/hyperframes" },
        b: { sourceUrl: "https://github.com/heygen-com/hyperframes.git" },
        c: { source: "https://github.com/heygen-com/hyperframes" },
        d: { source: "greensock/gsap-skills" },
      },
    };
    expect(skillsAttributedToSource(lock, "heygen-com/hyperframes").sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns [] for a null/empty lock or empty source", () => {
    expect(skillsAttributedToSource(null, "x")).toEqual([]);
    expect(skillsAttributedToSource({}, "x")).toEqual([]);
    expect(skillsAttributedToSource({ skills: { a: { source: "x" } } }, "")).toEqual([]);
  });
});

describe("checkSkills removed-upstream detection", () => {
  // The global lock path honours XDG_STATE_HOME; clear it so the fixture under
  // <home>/.agents/.skill-lock.json is the one that's read.
  let xdg: string | undefined;
  beforeEach(() => {
    xdg = process.env.XDG_STATE_HOME;
    delete process.env.XDG_STATE_HOME;
  });
  afterEach(() => {
    if (xdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = xdg;
  });

  // Install one or more `<skillsDir>/<name>/SKILL.md` bundles.
  function installSkills(skillsDir: string, names: string[]): void {
    for (const name of names) {
      mkdirSync(join(skillsDir, name), { recursive: true });
      writeFileSync(join(skillsDir, name, "SKILL.md"), `# ${name}`);
    }
  }

  // Shared fixture: a project + home with two skills installed globally
  // (alpha + gamma), plus a manifest path. Tests then write the lock they need.
  function setup(manifest: SkillsManifest): {
    home: string;
    opts: { source: string; cwd: string; home: string };
  } {
    const project = join(root, "project");
    const home = join(root, "home");
    mkdirSync(project, { recursive: true });
    installSkills(join(home, ".agents/skills"), ["alpha", "gamma"]);
    const manifestPath = join(root, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    return { home, opts: { source: manifestPath, cwd: project, home } };
  }
  function writeGlobalLock(home: string, skills: Record<string, { source: string }>): void {
    writeFileSync(join(home, ".agents/.skill-lock.json"), JSON.stringify({ version: 3, skills }));
  }

  it("flags a lock-attributed skill the manifest dropped, ignoring other sources", async () => {
    const { home, opts } = setup({ source: "test", skills: { alpha: { hash: "x", files: 1 } } });
    writeGlobalLock(home, {
      alpha: { source: "test" }, // still ours and in the manifest
      gamma: { source: "test" }, // ours, dropped from manifest → removed
      delta: { source: "someone/else" }, // a different source → never ours
    });

    const res = await checkSkills(opts);
    const byName = Object.fromEntries(res.skills.map((s) => [s.name, s.status]));
    expect(byName.gamma).toBe("removed");
    expect(byName.delta).toBeUndefined();
    expect(res.summary.removed).toBe(1);
  });

  it("a removed skill alone makes an update available (no outdated/missing)", async () => {
    // Manifest lists only alpha, with its REAL hash → "current" (not outdated).
    const { home, opts } = setup({ source: "test", skills: {} });
    const manifest: SkillsManifest = {
      source: "test",
      skills: { alpha: hashSkillBundle(join(home, ".agents/skills/alpha")) },
    };
    writeFileSync(opts.source, JSON.stringify(manifest));
    writeGlobalLock(home, { alpha: { source: "test" }, gamma: { source: "test" } });

    const res = await checkSkills(opts);
    expect(res.summary).toEqual({
      current: 1,
      outdated: 0,
      missing: 0,
      coreMissing: 0,
      removed: 1,
    });
    expect(res.updateAvailable).toBe(true);
  });

  it("reports no removed skills when there is no lock to attribute from", async () => {
    const { opts } = setup({ source: "test", skills: { alpha: { hash: "x", files: 1 } } });
    // gamma is an orphan on disk, but with no lock we can't attribute it to us.
    const res = await checkSkills(opts);
    expect(res.summary.removed).toBe(0);
    expect(res.skills.some((s) => s.status === "removed")).toBe(false);
    // No install was located via auto-detect (skills live under <home>/.agents/skills
    // which IS discovered) — so lockMissing reflects the genuinely-absent lock.
    expect(res.lockMissing).toBe(true);
  });

  // A `--dir` pointing at a global-scoped install (under $HOME) must resolve the
  // GLOBAL lock (<home>/.agents/.skill-lock.json), not the project lock
  // (<cwd>/skills-lock.json). Before this fix, locateInstall hardcoded scope
  // "project" for every --dir, so the global lock was never read and
  // removed-detection silently found nothing for --dir installs.
  it("--dir under $HOME resolves the global lock so removed-detection works", async () => {
    const { home, opts } = setup({ source: "test", skills: { alpha: { hash: "x", files: 1 } } });
    writeGlobalLock(home, {
      alpha: { source: "test" }, // ours and still in the manifest
      gamma: { source: "test" }, // ours, dropped from manifest → removed
    });

    const dir = join(home, ".agents/skills");
    const res = await checkSkills({ source: opts.source, dir, cwd: opts.cwd, home });
    expect(res.scope).toBe("global");
    const byName = Object.fromEntries(res.skills.map((s) => [s.name, s.status]));
    expect(byName.gamma).toBe("removed");
    expect(res.summary.removed).toBe(1);
    expect(res.lockMissing).toBe(false);
  });

  // Regression (Magi REQUEST_CHANGES at 88daa820): the common project-local case
  // is *also* under $HOME — a project checkout at `<home>/work/proj` with skills
  // at `<cwd>/.claude/skills`. A HOME-first heuristic misclassified this as
  // global, so checkSkills read the global lock and `skills update` would prune
  // with `-g` against a project install. CWD-containment must win: `--dir` under
  // `cwd` resolves to PROJECT even when `cwd` itself is nested under $HOME.
  it("--dir under a cwd that is itself nested under $HOME stays project-scoped", async () => {
    const home = join(root, "home");
    const project = join(home, "work", "proj"); // cwd nested INSIDE home
    const skillsDir = join(project, ".claude/skills");
    installSkills(skillsDir, ["alpha", "gamma"]);
    const manifestPath = join(root, "m3.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({ source: "test", skills: { alpha: { hash: "x", files: 1 } } }),
    );
    // Project lock at <cwd>/skills-lock.json — only read if scope is "project".
    // No global lock exists under $HOME, so a wrong-scope ("global") read would
    // find no lock → zero removed (gamma would NOT be flagged). The project lock
    // being read (gamma → removed) is the proof CWD-containment won.
    writeFileSync(
      join(project, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: { alpha: { source: "test" }, gamma: { source: "test" } },
      }),
    );

    const res = await checkSkills({ source: manifestPath, dir: skillsDir, cwd: project, home });
    expect(res.scope).toBe("project");
    const byName = Object.fromEntries(res.skills.map((s) => [s.name, s.status]));
    expect(byName.gamma).toBe("removed");
    expect(res.summary.removed).toBe(1);
  });

  // The complementary case: a `--dir` under the project tree (not $HOME) stays
  // project-scoped and reads <cwd>/skills-lock.json.
  it("--dir outside $HOME stays project-scoped and reads the project lock", async () => {
    const project = join(root, "proj2");
    const skillsDir = join(project, ".claude/skills");
    installSkills(skillsDir, ["alpha", "gamma"]);
    const manifestPath = join(root, "m2.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({ source: "test", skills: { alpha: { hash: "x", files: 1 } } }),
    );
    // Project lock lives at <cwd>/skills-lock.json — point cwd at the project.
    writeFileSync(
      join(project, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: { alpha: { source: "test" }, gamma: { source: "test" } },
      }),
    );
    const home = join(root, "home2");
    mkdirSync(home, { recursive: true });

    const res = await checkSkills({ source: manifestPath, dir: skillsDir, cwd: project, home });
    expect(res.scope).toBe("project");
    const byName = Object.fromEntries(res.skills.map((s) => [s.name, s.status]));
    expect(byName.gamma).toBe("removed");
    expect(res.summary.removed).toBe(1);
  });
});
