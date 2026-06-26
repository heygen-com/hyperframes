import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
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

/** Seed a real ~/.claude/skills store (the canonical global install). */
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
  it("no-ops when there is no global Claude store", () => {
    const home = makeHome();
    const result = mirrorGlobalSkills({ home, platform: "linux", env: ENV });
    expect(result.source).toBeNull();
    expect(result.mirrored).toEqual([]);
  });

  it("mirrors the store into installed agents as relative symlinks (Unix)", () => {
    const home = makeHome();
    seedStore(home, ["hyperframes", "hyperframes-core"]);
    installMarker(home, ".cursor"); // cursor present
    installMarker(home, ".config/goose"); // goose present (XDG base)
    // windsurf NOT installed (no ~/.codeium/windsurf)

    const { mirrored } = mirrorGlobalSkills({ home, platform: "linux", env: ENV });
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

  it("honors XDG_CONFIG_HOME for config-based agents", () => {
    const home = makeHome();
    const xdg = makeHome(); // a separate absolute XDG config root
    seedStore(home, ["hyperframes"]);
    mkdirSync(join(xdg, "goose"), { recursive: true }); // goose marker under XDG

    const { mirrored } = mirrorGlobalSkills({
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

    mirrorGlobalSkills({ home, platform: "win32", env: ENV });
    const target = join(home, ".cursor", "skills", "hyperframes");
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
    expect(lstatSync(target).isDirectory()).toBe(true);
    expect(existsSync(join(target, "SKILL.md"))).toBe(true);
  });

  it("never mirrors onto the install-owned stores (.claude / .agents)", () => {
    const home = makeHome();
    seedStore(home, ["hyperframes"]);
    installMarker(home, ".agents"); // .agents present (the universal install creates it)

    const { mirrored } = mirrorGlobalSkills({ home, platform: "linux", env: ENV });
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

    mirrorGlobalSkills({ home, platform: "linux", env: ENV });
    // second run must not throw and must leave a valid link
    const { mirrored } = mirrorGlobalSkills({ home, platform: "linux", env: ENV });
    expect(mirrored.map((m) => m.agent)).toContain("cursor");
    const link = join(home, ".cursor", "skills", "hyperframes");
    expect(realpathSync(link)).toBe(realpathSync(join(home, ".claude", "skills", "hyperframes")));
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
