import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
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
  MANIFEST_FILE,
  presentSkills,
  retiredSkillNotice,
  skillsAttributedToSource,
  type SkillsManifest,
  type SkillEntry,
} from "./skillsManifest.js";

// The retired-skill regression tests below drive `checkSkills`'s real
// `canonical: true` network path (see resolveLatestManifest) instead of an
// explicit local `source` — that's the whole point (it must NOT read a stale
// local repo manifest). Stub the two network boundaries it can reach so those
// tests stay fast and offline: `git ls-remote` (remoteHeadSha) always "fails"
// so it falls back to the branch URL, and `fetch` is stubbed per-test. `vi.mock`
// is hoisted above these imports regardless of source position. No existing
// test in this file omits `source`, so nothing else touches this mock.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      callback: (err: Error | null) => void,
    ) => callback(new Error("no git in tests")),
  ),
}));

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

  it("ignores Python bytecode a skill script leaves behind, but not a real edit", () => {
    const dir = writeSkill("a", {
      "SKILL.md": "hello",
      "scripts/lib/auth.py": "x = 1\n",
    });
    const clean = hashSkillBundle(dir);
    mkdirSync(join(dir, "scripts/lib/__pycache__"));
    writeFileSync(join(dir, "scripts/lib/__pycache__/auth.cpython-312.pyc"), "\x00bytecode");
    writeFileSync(join(dir, "scripts/lib/stray.pyc"), "\x00bytecode");
    expect(hashSkillBundle(dir)).toEqual(clean);

    writeFileSync(join(dir, "scripts/lib/auth.py"), "x = 2\n");
    expect(hashSkillBundle(dir).hash).not.toBe(clean.hash);
  });

  it("ignores dependency installs, OS files, and editor swap files", () => {
    const dir = writeSkill("a", { "SKILL.md": "hello", "scripts/run.mjs": "run();" });
    const clean = hashSkillBundle(dir);
    writeSkill("a", {
      "node_modules/dep/index.js": "module.exports = 1;",
      "scripts/.DS_Store": "",
      "scripts/.run.mjs.swp": "swap",
      "SKILL.md~": "backup",
    });
    expect(hashSkillBundle(dir)).toEqual(clean);
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
    expect(isCoreSkill("hyperframes-cli")).toBe(true);
    expect(isCoreSkill("hyperframes-registry")).toBe(true);
    expect(isCoreSkill("media-use")).toBe(true);
    // Decks, ports and optional integrations install on demand.
    expect(isCoreSkill("slideshow")).toBe(false);
    expect(isCoreSkill("remotion-to-hyperframes")).toBe(false);
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

describe(".claude-plugin/marketplace.json core-skills pin", () => {
  // The marketplace `core-skills` entry's `skills` array drives two surfaces:
  // the upstream `skills add` picker groups the listed skills under
  // "Core Skills" (everything unlisted falls into "Other"), and Claude Code
  // treats the array as that plugin's skill allowlist. That makes it a third
  // enumeration of core membership — pin it to isCoreSkill and the skills/
  // tree so neither surface can silently drift from the tiers `init` /
  // `skills update` actually enforce. It lives on a separate marketplace
  // entry (not plugin.json, and not the `hyperframes` entry) precisely so
  // the full `hyperframes` plugin keeps auto-discovering all skills.
  it("lists exactly the core skills present in the repo's skills/ tree", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const marketplace = JSON.parse(
      readFileSync(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf-8"),
    ) as { plugins?: { name?: string; skills?: string[] }[] };
    const entry = marketplace.plugins?.find((p) => p.name === "core-skills");
    if (!entry?.skills) {
      throw new Error("marketplace.json is missing the core-skills entry's `skills` array");
    }
    const declared = entry.skills.map((p) => p.replace(/^\.\/skills\//, "")).sort();

    const skillsRoot = join(repoRoot, "skills");
    const coreOnDisk = readdirSync(skillsRoot)
      .filter((n) => existsSync(join(skillsRoot, n, "SKILL.md")))
      .filter((n) => isCoreSkill(n))
      .sort();

    expect(declared).toEqual(coreOnDisk);
    // Upstream resolves each entry relative to the repo root — the "./skills/"
    // prefix is load-bearing (see vercel-labs/skills plugin-manifest.ts).
    for (const p of entry.skills) {
      expect(p.startsWith("./skills/")).toBe(true);
    }
    // The full plugin must NOT carry a skills allowlist: Claude Code would
    // narrow it to the listed subset instead of auto-discovering all skills.
    const full = marketplace.plugins?.find((p) => p.name === "hyperframes");
    expect(full).toBeDefined();
    expect(full?.skills).toBeUndefined();
    // Same for plugin.json (the direct-install manifest for the full plugin) —
    // and upstream lets plugin.json groupings override marketplace ones, so a
    // skills array here would also rename the picker group back to
    // "Hyperframes".
    const plugin = JSON.parse(
      readFileSync(join(repoRoot, ".claude-plugin", "plugin.json"), "utf-8"),
    ) as { skills?: string[] };
    expect(plugin.skills).toBeUndefined();
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
        slideshow: { hash: "w1", files: 1 }, // on-demand workflow
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
    const coreMissing = diffSkills({ slideshow: { hash: "w1", files: 1 } }, withCore);
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

    expect(presentSkills(["hyperframes", "slideshow"], { cwd: project, home })).toEqual([
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

describe("retiredSkillNotice", () => {
  it("says where a retired skill's knowledge lives", () => {
    expect(retiredSkillNotice("hyperframes-audio")).toContain("media-use");
    expect(retiredSkillNotice("motion-graphics")).toContain("/hyperframes skill");
  });
});

describe("checkSkills foreign skills", () => {
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
  // Upstream writes a `skillPath` on every lock entry it creates (verified
  // against a real ~/.agents/.skill-lock.json written by skills@1.5.22), and
  // removed-detection now reads it to tell manifest-covered skills apart from
  // ones installed out of the repo's other skill roots — see
  // manifestCoversSkill / GH #3111. Default to the covered root so each existing
  // fixture keeps meaning "a normally published skill"; pass skillPath
  // explicitly to model anything else.
  function writeGlobalLock(
    home: string,
    skills: Record<string, { source: string; skillPath?: string }>,
  ): void {
    const withPaths = Object.fromEntries(
      Object.entries(skills).map(([name, entry]) => [
        name,
        { skillPath: `skills/${name}/SKILL.md`, ...entry },
      ]),
    );
    writeFileSync(
      join(home, ".agents/.skill-lock.json"),
      JSON.stringify({ version: 3, skills: withPaths }),
    );
  }

  it("never compares or refreshes a skill another publisher installed under one of our names", async () => {
    const { home, opts } = setup({ source: "test", skills: { alpha: { hash: "x", files: 1 } } });
    writeGlobalLock(home, { alpha: { source: "someone/else" } });

    const res = await checkSkills(opts);

    expect(res.skills.find((s) => s.name === "alpha")).toBeUndefined();
    expect(res.foreign).toEqual(["alpha"]);
    expect(res.updateAvailable).toBe(false);
  });

  it("never compares or refreshes a skill another publisher installed under one of our names", async () => {
    const { home, opts } = setup({ source: "test", skills: { alpha: { hash: "x", files: 1 } } });
    writeGlobalLock(home, { alpha: { source: "someone/else" } });

    const res = await checkSkills(opts);

    expect(res.skills.find((s) => s.name === "alpha")).toBeUndefined();
    expect(res.foreign).toEqual(["alpha"]);
    expect(res.updateAvailable).toBe(false);
  });

  it("treats a skill with no lock entry as ours: provenance unknown, not foreign", async () => {
    const { opts } = setup({ source: "test", skills: { alpha: { hash: "x", files: 1 } } });

    const res = await checkSkills(opts);

    expect(res.foreign).toEqual([]);
    expect(res.skills.find((s) => s.name === "alpha")?.status).toBe("outdated");
  });

  it("never reports a skill the manifest dropped as an update", async () => {
    const { home, opts } = setup({ source: "test", skills: { alpha: { hash: "x", files: 1 } } });
    writeGlobalLock(home, { alpha: { source: "test" }, gamma: { source: "test" } });

    const res = await checkSkills(opts);

    expect(res.skills.map((s) => s.name)).toEqual(["alpha"]);
  });
});

describe("checkSkills canonical bypass of the in-repo manifest shortcut", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchedManifest(manifest: SkillsManifest): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => manifest }) as unknown as Response),
    );
  }

  it("without canonical, a stale in-repo manifest wins (documented dev/CI shortcut)", async () => {
    const project = join(root, "project");
    const home = join(root, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });
    // A checked-out repo's own manifest, stale: it still lists a skill that
    // has since been retired from the canonical published repo.
    writeFileSync(
      join(project, MANIFEST_FILE),
      JSON.stringify({
        source: "heygen-com/hyperframes",
        skills: { "retired-skill": { hash: "x", files: 1 } },
      }),
    );

    const res = await checkSkills({ cwd: project, home });
    expect(res.skills.map((s) => s.name)).toContain("retired-skill");
  });

  it("with canonical:true, the same stale in-repo manifest is ignored — the fetched manifest wins", async () => {
    const project = join(root, "project");
    const home = join(root, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(project, MANIFEST_FILE),
      JSON.stringify({
        source: "heygen-com/hyperframes",
        skills: { "retired-skill": { hash: "x", files: 1 }, kept: { hash: "y", files: 1 } },
      }),
    );
    // The canonical (fetched) manifest no longer ships `retired-skill`.
    stubFetchedManifest({
      source: "heygen-com/hyperframes",
      skills: { kept: { hash: "y", files: 1 } },
    });

    const res = await checkSkills({ cwd: project, home, canonical: true });
    expect(res.skills.map((s) => s.name)).not.toContain("retired-skill");
    expect(res.skills.map((s) => s.name)).toContain("kept");
    // The background check runs this with no console; git must not open one on Windows.
    expect(vi.mocked(execFile)).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["ls-remote"]),
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
  });

  it("canonical:true still honors an explicit local `source` override", async () => {
    const project = join(root, "project");
    const home = join(root, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(project, MANIFEST_FILE),
      JSON.stringify({ source: "test", skills: { "from-repo-shortcut": { hash: "x", files: 1 } } }),
    );
    const explicitSource = join(root, "explicit-manifest.json");
    writeFileSync(
      explicitSource,
      JSON.stringify({
        source: "test",
        skills: { "from-explicit-source": { hash: "y", files: 1 } },
      }),
    );

    // An explicit `source` is a deliberate caller choice — canonical must not
    // override it, only the silent in-repo shortcut.
    const res = await checkSkills({ source: explicitSource, cwd: project, home, canonical: true });
    expect(res.skills.map((s) => s.name)).toEqual(["from-explicit-source"]);
  });
});
