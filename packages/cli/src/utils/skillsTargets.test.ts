import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillsAddArgs, resolveAgentTargets } from "./skillsTargets.js";

const tmpDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** A project root containing the given `<host>/skills` folders. */
function projectWith(...hostDirs: string[]): string {
  const root = tempDir("hf-targets-proj-");
  for (const host of hostDirs) mkdirSync(join(root, host, "skills"), { recursive: true });
  return root;
}

/** A PATH-style string pointing at a dir that contains the given fake executables. */
function pathWith(...bins: string[]): string {
  const dir = tempDir("hf-targets-bin-");
  for (const bin of bins) writeFileSync(join(dir, bin), "");
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("resolveAgentTargets", () => {
  const blank = { env: {}, pathStr: "", platform: "linux" as const };

  // ── 1. Existing project folders win, mapped dir → upstream key ──────────────

  it("honours an existing `.hermes/skills` folder, nothing else", () => {
    const result = resolveAgentTargets({ ...blank, cwd: projectWith(".hermes") });
    expect(result.agents).toEqual(["hermes-agent"]);
  });

  it("maps `.factory` → droid and `.kiro` → kiro-cli (dir names differ from keys)", () => {
    const result = resolveAgentTargets({ ...blank, cwd: projectWith(".factory", ".kiro") });
    expect(result.agents).toEqual(["droid", "kiro-cli"]);
  });

  it("maps the shared `.agents` dir to the single `universal` key", () => {
    const result = resolveAgentTargets({ ...blank, cwd: projectWith(".agents") });
    expect(result.agents).toEqual(["universal"]);
  });

  it("returns claude-code first across multiple existing folders", () => {
    const result = resolveAgentTargets({ ...blank, cwd: projectWith(".agents", ".claude") });
    expect(result.agents).toEqual(["claude-code", "universal"]);
  });

  it("existing folders take precedence over CLAUDECODE and PATH", () => {
    const result = resolveAgentTargets({
      cwd: projectWith(".hermes"),
      env: { CLAUDECODE: "1" },
      pathStr: pathWith("claude", "cursor"),
      platform: "linux",
    });
    expect(result.agents).toEqual(["hermes-agent"]);
  });

  // ── 2a. Claude Code env on a blank project ──────────────────────────────────

  it("targets just claude-code when running under Claude Code", () => {
    const result = resolveAgentTargets({
      ...blank,
      cwd: projectWith(),
      env: { CLAUDECODE: "1" },
    });
    expect(result.agents).toEqual(["claude-code"]);
  });

  // ── 2b. gstack route: installed agent CLIs on PATH ──────────────────────────

  it("detects installed agent CLIs on PATH (blank project, no CLAUDECODE)", () => {
    const result = resolveAgentTargets({
      cwd: projectWith(),
      env: {},
      pathStr: pathWith("claude", "hermes"),
      platform: "linux",
    });
    expect(result.agents).toEqual(["claude-code", "hermes-agent"]);
  });

  it("collapses universal-bucket CLIs (cursor/codex/…) to a single `universal`", () => {
    const result = resolveAgentTargets({
      cwd: projectWith(),
      env: {},
      pathStr: pathWith("cursor", "codex", "gemini"),
      platform: "linux",
    });
    expect(result.agents).toEqual(["universal"]);
  });

  // ── 2c. Floor ───────────────────────────────────────────────────────────────

  it("falls back to claude-code + universal (.claude + .agents) when nothing is found", () => {
    const result = resolveAgentTargets({ ...blank, cwd: projectWith() });
    expect(result.agents).toEqual(["claude-code", "universal"]);
  });

  // ── Invariant: never the `--all` spray ──────────────────────────────────────

  it("never returns the `'*'` wildcard agent", () => {
    for (const cwd of [projectWith(), projectWith(".hermes"), projectWith(".claude")]) {
      const result = resolveAgentTargets({ ...blank, cwd });
      expect(result.agents).not.toContain("*");
      expect(result.agents.length).toBeGreaterThan(0);
    }
  });
});

describe("buildSkillsAddArgs", () => {
  it("installs every skill to the given agents, non-interactive — not `--all`", () => {
    expect(buildSkillsAddArgs(["claude-code", "universal"])).toEqual([
      "--skill",
      "*",
      "--agent",
      "claude-code",
      "universal",
      "--yes",
    ]);
  });
});
