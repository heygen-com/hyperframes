// The mirror shells out to git, so mock `node:child_process` at the loader level
// (the same approach skills.test.ts takes) and let the fake clone create the
// files the code then validates.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type GitCall = { args: string[]; cwd: string | undefined };

const state: {
  calls: GitCall[];
  /** Substring of an argv that should make git fail. */
  failOn?: string;
  /** What `git rev-parse HEAD` reports. */
  head: string;
  origin: string;
} = { calls: [], head: "sha-wanted", origin: "" };

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn((command: string, args: string[], opts?: { cwd?: string }) => {
    state.calls.push({ args, cwd: opts?.cwd });
    if (command !== "git") throw new Error(`unexpected command: ${command}`);
    if (state.failOn && args.join(" ").includes(state.failOn)) {
      throw Object.assign(new Error("git failed"), { stderr: "fatal: nope" });
    }
    const [command0] = args;
    if (command0 === "clone") {
      const dest = args[args.length - 1]!;
      mkdirSync(join(dest, ".git"), { recursive: true });
      mkdirSync(join(dest, "skills", "hyperframes"), { recursive: true });
      writeFileSync(join(dest, "skills", "hyperframes", "SKILL.md"), "# hyperframes\n");
      return "";
    }
    if (command0 === "sparse-checkout") {
      mkdirSync(join(opts?.cwd ?? ".", "skills"), { recursive: true });
      return "";
    }
    if (command0 === "remote") return `${state.origin}\n`;
    if (command0 === "rev-parse") return args[1] === "HEAD" ? `${state.head}\n` : "sha-wanted\n";
    return "";
  }),
}));

const cacheRoot = mkdtempSync(join(tmpdir(), "hf-mirror-"));
const mirrorDir = join(cacheRoot, "skills-repo", "1");

async function load() {
  return import("./skillsRepoMirror.js");
}

function seedCheckout(dir: string, origin: string): void {
  mkdirSync(join(dir, ".git"), { recursive: true });
  mkdirSync(join(dir, "skills", "hyperframes"), { recursive: true });
  writeFileSync(join(dir, "skills", "hyperframes", "SKILL.md"), "---\nname: hyperframes\n---\n");
  state.origin = origin;
}

describe("ensureSkillsRepoMirror", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", cacheRoot);
    vi.stubEnv("HYPERFRAMES_SKILLS_MIRROR", "");
    state.calls = [];
    state.failOn = undefined;
    state.head = "sha-wanted";
    rmSync(mirrorDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a blobless sparse checkout of just skills/ on first use", async () => {
    const { ensureSkillsRepoMirror } = await load();
    const result = ensureSkillsRepoMirror({
      url: "https://github.com/heygen-com/hyperframes",
      ref: "main",
    });

    expect(result).toEqual({ dir: mirrorDir, created: true });
    const clone = state.calls[0]!.args;
    expect(clone.slice(0, 9)).toEqual([
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--depth=1",
      "--sparse",
      "--single-branch",
      "--branch",
      "main",
      "https://github.com/heygen-com/hyperframes",
    ]);
    expect(state.calls[1]!.args).toEqual(["sparse-checkout", "set", "skills"]);
    // The staging dir it cloned into is renamed into place, never left behind.
    expect(existsSync(join(mirrorDir, "skills", "hyperframes", "SKILL.md"))).toBe(true);
    expect(existsSync(`${mirrorDir}.partial-${process.pid}`)).toBe(false);
  });

  it("fetches the delta into an existing checkout instead of re-cloning", async () => {
    const { ensureSkillsRepoMirror } = await load();
    seedCheckout(mirrorDir, "https://github.com/heygen-com/hyperframes");

    const result = ensureSkillsRepoMirror({
      url: "https://github.com/heygen-com/hyperframes",
      ref: "main",
    });

    expect(result).toEqual({ dir: mirrorDir, created: false });
    expect(state.calls.map((call) => call.args[0])).toEqual([
      "remote",
      "fetch",
      "rev-parse",
      "checkout",
      "rev-parse",
    ]);
    expect(state.calls[1]!.args).toEqual([
      "fetch",
      "--quiet",
      "--depth=1",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ]);
    // No staging clone happened.
    expect(state.calls.some((call) => call.args[0] === "clone")).toBe(false);
  });

  it("checks out a release tag when the check resolved one", async () => {
    const { ensureSkillsRepoMirror } = await load();
    seedCheckout(mirrorDir, "https://github.com/heygen-com/hyperframes");

    ensureSkillsRepoMirror({ url: "https://github.com/heygen-com/hyperframes", ref: "v0.9.61" });

    expect(state.calls.map((call) => call.args)).toContainEqual([
      "fetch",
      "--quiet",
      "--depth=1",
      "origin",
      "+refs/tags/v0.9.61:refs/tags/v0.9.61",
    ]);
    expect(state.calls.map((call) => call.args)).toContainEqual([
      "checkout",
      "--quiet",
      "--force",
      "refs/tags/v0.9.61",
    ]);
  });

  it("returns null (caller falls back to the URL clone) when git fails", async () => {
    const { ensureSkillsRepoMirror } = await load();
    seedCheckout(mirrorDir, "https://github.com/heygen-com/hyperframes");
    state.failOn = "fetch";

    expect(
      ensureSkillsRepoMirror({ url: "https://github.com/heygen-com/hyperframes", ref: "main" }),
    ).toBeNull();
  });

  it("returns null when the checkout does not land on the fetched commit", async () => {
    const { ensureSkillsRepoMirror } = await load();
    seedCheckout(mirrorDir, "https://github.com/heygen-com/hyperframes");
    state.head = "sha-other";

    expect(
      ensureSkillsRepoMirror({ url: "https://github.com/heygen-com/hyperframes", ref: "main" }),
    ).toBeNull();
  });

  it("refuses a ref that could smuggle a flag or a transport", async () => {
    const { ensureSkillsRepoMirror } = await load();
    for (const ref of ["--upload-pack=evil", "ext::sh -c whoami", "a b"]) {
      expect(
        ensureSkillsRepoMirror({ url: "https://github.com/heygen-com/hyperframes", ref }),
      ).toBeNull();
    }
    expect(state.calls).toEqual([]);
    // A blank ref is not a ref — it falls back to main, the default install ref.
    expect(
      ensureSkillsRepoMirror({ url: "https://github.com/heygen-com/hyperframes", ref: "  " }),
    ).toEqual({ dir: mirrorDir, created: true });
    expect(state.calls[0]?.args).toContain("main");
  });

  it("can be switched off for diagnosis", async () => {
    const { ensureSkillsRepoMirror } = await load();
    vi.stubEnv("HYPERFRAMES_SKILLS_MIRROR", "0");

    expect(
      ensureSkillsRepoMirror({ url: "https://github.com/heygen-com/hyperframes", ref: "main" }),
    ).toBeNull();
    expect(state.calls).toEqual([]);
  });
});

describe("publishedSkillNames", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", cacheRoot);
    rmSync(mirrorDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists one name per skill directory in the checkout", async () => {
    const { publishedSkillNames } = await load();
    seedCheckout(mirrorDir, "https://github.com/heygen-com/hyperframes");
    mkdirSync(join(mirrorDir, "skills", "no-skill-md"), { recursive: true });

    expect(publishedSkillNames(mirrorDir)).toEqual(["hyperframes"]);
    expect(publishedSkillNames(undefined)).toEqual([]);
    expect(publishedSkillNames(join(mirrorDir, "missing"))).toEqual([]);
  });
});

describe("isSkillsRepoMirrorPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("recognises the mirror (and paths inside it) only", async () => {
    vi.resetModules();
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", cacheRoot);
    const { isSkillsRepoMirrorPath } = await load();

    expect(isSkillsRepoMirrorPath(mirrorDir)).toBe(true);
    expect(isSkillsRepoMirrorPath(join(mirrorDir, "skills"))).toBe(true);
    expect(isSkillsRepoMirrorPath(`${mirrorDir}-backup`)).toBe(false);
    expect(isSkillsRepoMirrorPath(join(cacheRoot, "skills-repo"))).toBe(false);
    expect(isSkillsRepoMirrorPath("/home/someone/checkout")).toBe(false);
    expect(isSkillsRepoMirrorPath(undefined)).toBe(false);
  });
});
