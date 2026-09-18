import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { mirrorGlobalSkills } from "./skillsMirror.js";
import { AGENT_GLOBAL_DIRS } from "./agentDirs.generated.js";

const tmpDirs: string[] = [];

// Resolve agent dirs under the isolated HOME with default (unset) env, so the
// dev machine's real XDG_CONFIG_HOME / CODEX_HOME never leak into the test.
const ENV: NodeJS.ProcessEnv = {};

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "mirror-home-"));
  tmpDirs.push(home);
  return home;
}

/** Seed real skill bundles under ~/.claude/skills (the canonical global store). */
function seedStore(home: string, skills: string[]): void {
  for (const name of skills) {
    const dir = join(home, ".claude", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `# ${name}\n`, "utf8");
  }
}

/** Pretend an agent is installed by creating its marker dir. */
function installMarker(home: string, marker: string): void {
  mkdirSync(join(home, ...marker.split("/")), { recursive: true });
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("mirrorGlobalSkills", () => {
  it.each([
    [
      "absolute",
      (home: string, source: string) => symlinkSync(source, join(home, ".cursor", "skills")),
    ],
    [
      "relative",
      (home: string) => symlinkSync("../.claude/skills", join(home, ".cursor", "skills")),
    ],
    ["intermediate", (home: string) => symlinkSync(".claude", join(home, ".cursor"))],
  ])(
    "fails closed when the target reaches the canonical store through a %s alias",
    (_kind, alias) => {
      const home = makeHome();
      seedStore(home, ["hyperframes"]);
      const source = join(home, ".claude", "skills");
      if (_kind !== "intermediate") installMarker(home, ".cursor");
      alias(home, source);

      const result = mirrorGlobalSkills({
        skills: ["hyperframes"],
        home,
        platform: "linux",
        env: ENV,
      });

      expect(lstatSync(join(source, "hyperframes")).isDirectory()).toBe(true);
      expect(readFileSync(join(source, "hyperframes", "SKILL.md"), "utf8")).toBe("# hyperframes\n");
      expect(result.mirrored.map((entry) => entry.agent)).not.toContain("cursor");
      expect(result.skipped).toContainEqual(
        expect.objectContaining({ agent: "cursor", reason: "aliases_install_owned_store" }),
      );
    },
  );

  it("fails closed and reports an unresolvable self-loop before destructive mirroring", () => {
    const home = makeHome();
    seedStore(home, ["hyperframes"]);
    installMarker(home, ".cursor");
    symlinkSync("skills", join(home, ".cursor", "skills"));

    const result = mirrorGlobalSkills({
      skills: ["hyperframes"],
      home,
      platform: "linux",
      env: ENV,
    });

    expect(readFileSync(join(home, ".claude", "skills", "hyperframes", "SKILL.md"), "utf8")).toBe(
      "# hyperframes\n",
    );
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ agent: "cursor", reason: "unresolvable_target" }),
    );
  });

  it("no-ops when there is no global Claude store", () => {
    const home = makeHome();
    const result = mirrorGlobalSkills({
      skills: ["hyperframes"],
      home,
      platform: "linux",
      env: ENV,
    });
    expect(result.source).toBeNull();
    expect(result.mirrored).toEqual([]);
  });

  it("mirrors the store into installed agents as relative symlinks (Unix)", () => {
    const home = makeHome();
    seedStore(home, ["hyperframes", "hyperframes-core"]);
    installMarker(home, ".cursor"); // cursor present
    installMarker(home, ".config/goose"); // goose present (XDG base)
    // windsurf NOT installed (no ~/.codeium/windsurf)

    const { mirrored } = mirrorGlobalSkills({
      skills: ["hyperframes", "hyperframes-core"],
      home,
      platform: "linux",
      env: ENV,
    });
    const agents = mirrored.map((m) => m.agent);
    expect(agents).toContain("cursor");
    expect(agents).toContain("goose");
    expect(agents).not.toContain("windsurf");

    const link = join(home, ".cursor", "skills", "hyperframes");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(isAbsolute(readlinkSync(link))).toBe(false); // relative target
    expect(realpathSync(link)).toBe(realpathSync(join(home, ".claude", "skills", "hyperframes")));
    expect(existsSync(join(link, "SKILL.md"))).toBe(true);

    // goose lands in the XDG config dir (~/.config/goose), not ~/.goose
    expect(
      existsSync(join(home, ".config", "goose", "skills", "hyperframes-core", "SKILL.md")),
    ).toBe(true);
  });

  // The blocker Magi flagged: ~/.claude/skills is shared, so a user's gstack /
  // personal / company skills live there too. The mirror must fan out ONLY
  // HyperFrames' own skills (the lock-attributed allow-list), never everything
  // in the store — and must not remove/replace a same-named skill already in
  // another agent's dir.
  it("only mirrors the allow-listed skills, never other sources' (gstack)", () => {
    const home = makeHome();
    seedStore(home, ["hyperframes", "gstack"]); // gstack is a foreign skill in the store
    installMarker(home, ".cursor");
    // cursor already has its OWN gstack skill from another source — must survive.
    const foreign = join(home, ".cursor", "skills", "gstack");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "SKILL.md"), "# gstack (cursor's own, not ours)\n", "utf8");

    mirrorGlobalSkills({ skills: ["hyperframes"], home, platform: "linux", env: ENV });

    // our skill got linked
    expect(lstatSync(join(home, ".cursor", "skills", "hyperframes")).isSymbolicLink()).toBe(true);
    // gstack was NOT mirrored from the store...
    expect(existsSync(join(home, ".claude", "skills", "gstack"))).toBe(true); // still in store
    // ...and cursor's pre-existing gstack was neither replaced with a symlink nor removed
    expect(lstatSync(foreign).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(foreign, "SKILL.md"), "utf8")).toContain("cursor's own");
  });

  it("honors XDG_CONFIG_HOME for config-based agents", () => {
    const home = makeHome();
    const xdg = makeHome(); // a separate absolute XDG config root
    seedStore(home, ["hyperframes"]);
    mkdirSync(join(xdg, "goose"), { recursive: true }); // goose marker under XDG

    const { mirrored } = mirrorGlobalSkills({
      skills: ["hyperframes"],
      home,
      platform: "linux",
      env: { XDG_CONFIG_HOME: xdg },
    });
    expect(mirrored.map((m) => m.agent)).toContain("goose");
    expect(existsSync(join(xdg, "goose", "skills", "hyperframes", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".config", "goose", "skills"))).toBe(false);
  });

  it("copies instead of symlinking on Windows", () => {
    const home = makeHome();
    seedStore(home, ["hyperframes"]);
    installMarker(home, ".cursor");

    mirrorGlobalSkills({ skills: ["hyperframes"], home, platform: "win32", env: ENV });
    const target = join(home, ".cursor", "skills", "hyperframes");
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
    expect(lstatSync(target).isDirectory()).toBe(true);
    expect(existsSync(join(target, "SKILL.md"))).toBe(true);
  });

  it("never mirrors onto the install-owned stores (.claude / .agents)", () => {
    const home = makeHome();
    seedStore(home, ["hyperframes"]);
    installMarker(home, ".agents"); // .agents present (the universal install creates it)

    const { mirrored } = mirrorGlobalSkills({
      skills: ["hyperframes"],
      home,
      platform: "linux",
      env: ENV,
    });
    expect(mirrored.map((m) => m.agent)).not.toContain("claude-code");
    // the .agents-family agents (cline/dexto/…) map to .agents/skills and are skipped
    expect(mirrored.map((m) => m.agent)).not.toContain("cline");
    // ~/.agents/skills is the real universal store — must stay untouched (no link created)
    expect(existsSync(join(home, ".agents", "skills"))).toBe(false);
  });

  it("is idempotent and refreshes stale entries", () => {
    const home = makeHome();
    seedStore(home, ["hyperframes"]);
    installMarker(home, ".cursor");

    mirrorGlobalSkills({ skills: ["hyperframes"], home, platform: "linux", env: ENV });
    // second run must not throw and must leave a valid link
    const { mirrored } = mirrorGlobalSkills({
      skills: ["hyperframes"],
      home,
      platform: "linux",
      env: ENV,
    });
    expect(mirrored.map((m) => m.agent)).toContain("cursor");
    const link = join(home, ".cursor", "skills", "hyperframes");
    expect(realpathSync(link)).toBe(realpathSync(join(home, ".claude", "skills", "hyperframes")));
  });

  it("does not mirror Codex when the universal store is available", () => {
    const home = makeHome();
    seedStore(home, ["hyperframes"]);
    installMarker(home, ".codex");
    mkdirSync(join(home, ".agents", "skills", "hyperframes"), { recursive: true });
    writeFileSync(join(home, ".agents", "skills", "hyperframes", "SKILL.md"), "# universal\n");
    mkdirSync(join(home, ".codex", "skills", ".system"), { recursive: true });

    const { mirrored } = mirrorGlobalSkills({
      skills: ["hyperframes"],
      home,
      platform: "linux",
      env: ENV,
    });

    expect(mirrored.map((entry) => entry.agent)).not.toContain("codex");
    expect(existsSync(join(home, ".codex", "skills", ".system"))).toBe(true);
    expect(existsSync(join(home, ".codex", "skills", "hyperframes"))).toBe(false);
  });

  it("does not mirror Codex under a custom CODEX_HOME", () => {
    const home = makeHome();
    const codexHome = makeHome();
    seedStore(home, ["hyperframes"]);
    installMarker(home, ".codex");
    mkdirSync(join(home, ".agents", "skills", "hyperframes"), { recursive: true });
    writeFileSync(join(home, ".agents", "skills", "hyperframes", "SKILL.md"), "# universal\n");
    const existing = join(codexHome, "skills", "hyperframes");
    mkdirSync(existing, { recursive: true });
    writeFileSync(join(existing, "SKILL.md"), "# locally managed\n", "utf8");

    const { mirrored } = mirrorGlobalSkills({
      skills: ["hyperframes"],
      home,
      platform: "linux",
      env: { CODEX_HOME: codexHome },
    });

    expect(mirrored.map((entry) => entry.agent)).not.toContain("codex");
    expect(readFileSync(join(existing, "SKILL.md"), "utf8")).toBe("# locally managed\n");
  });

  // Pi natively discovers BOTH ~/.pi/agent/skills and the universal
  // ~/.agents/skills (pi's packages/coding-agent/docs/skills.md#locations).
  // A mirrored per-agent copy collides with the universal one and Pi skips
  // the universal entry on name conflict (#3294), so the mirror must not fan
  // out to it.
  it("skips agents that natively read the universal store (pi, #3294)", () => {
    const home = makeHome();
    seedStore(home, ["hyperframes"]);
    installMarker(home, ".pi/agent"); // Pi present
    installMarker(home, ".cursor"); // a regular per-dir agent, for contrast

    const { mirrored } = mirrorGlobalSkills({
      skills: ["hyperframes"],
      home,
      platform: "linux",
      env: ENV,
    });
    const agents = mirrored.map((m) => m.agent);
    expect(agents).not.toContain("pi");
    expect(agents).toContain("cursor");
    // no per-agent copy created where the universal store already serves Pi
    expect(existsSync(join(home, ".pi", "agent", "skills", "hyperframes"))).toBe(false);
  });
});

describe("AGENT_GLOBAL_DIRS (generated table)", () => {
  it("is a non-trivial, well-formed table", () => {
    const validBases = new Set([
      "home",
      "configHome",
      "codexHome",
      "claudeHome",
      "vibeHome",
      "hermesHome",
      "autohandHome",
    ]);
    expect(AGENT_GLOBAL_DIRS.length).toBeGreaterThan(50);
    for (const e of AGENT_GLOBAL_DIRS) {
      expect(validBases.has(e.base)).toBe(true);
      expect(e.sub.endsWith("skills")).toBe(true);
      expect(e.sub.startsWith("/")).toBe(false); // a suffix, not an absolute path
    }
  });

  it("covers the major agents at their real bases", () => {
    const byAgent = new Map(AGENT_GLOBAL_DIRS.map((e) => [e.agent, e]));
    expect(byAgent.get("claude-code")).toMatchObject({ base: "claudeHome", sub: "skills" });
    expect(byAgent.get("cursor")).toMatchObject({ base: "home", sub: ".cursor/skills" });
    expect(byAgent.get("codex")).toMatchObject({ base: "codexHome", sub: "skills" });
    expect(byAgent.get("goose")).toMatchObject({ base: "configHome", sub: "goose/skills" });
    expect(byAgent.get("windsurf")).toMatchObject({
      base: "home",
      sub: ".codeium/windsurf/skills",
    });
    expect(byAgent.get("droid")).toMatchObject({ base: "home", sub: ".factory/skills" });
    // bare-dir-in-project agents become namespaced globally (no footgun)
    expect(byAgent.get("openclaw")).toMatchObject({ base: "home", sub: ".openclaw/skills" });
    // agents with no upstream global dir are omitted
    expect(byAgent.has("eve")).toBe(false);
    expect(byAgent.has("promptscript")).toBe(false);
  });
});
