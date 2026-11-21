// The mirror shells out to git, so mock `node:child_process` at the loader level
// (the same approach skills.test.ts takes) and let the fake git create the files
// the code then validates. The fake tracks the checked-out ref so a second
// invocation can switch the shared checkout underneath a first one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type GitCall = { args: string[]; cwd: string | undefined };

const CONTENT = (ref: string) => `# ${ref}\n`;
const SHA: Record<string, string> = {
  v1: "aaaaaaa1111",
  v2: "bbbbbbb2222",
  main: "ccccccc3333",
};
const shaOf = (ref: string) => SHA[ref] ?? "ddddddd4444";

/** `refs/tags/v1` / `+refs/heads/main:refs/remotes/origin/main` → `v1` / `main`. */
const refOf = (spec: string) =>
  spec
    .replace(/^\+?refs\/(heads|tags)\//, "")
    .replace(/:.*$/, "")
    .replace(/^FETCH_HEAD$/, "");

const state: {
  calls: GitCall[];
  failOn?: string;
  origin: string;
  currentRef: string;
  fetchedRef: string;
  /** Report a HEAD other than the fetched commit, to model a racing checkout. */
  divergeHead: boolean;
} = { calls: [], origin: "", currentRef: "", fetchedRef: "", divergeHead: false };

function writeSkill(dir: string, ref: string): void {
  mkdirSync(join(dir, "skills", "hyperframes"), { recursive: true });
  writeFileSync(join(dir, "skills", "hyperframes", "SKILL.md"), CONTENT(ref));
}

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn((command: string, args: string[], opts?: { cwd?: string }) => {
    state.calls.push({ args, cwd: opts?.cwd });
    if (command !== "git") throw new Error(`unexpected command: ${command}`);
    if (state.failOn && args.join(" ").includes(state.failOn)) {
      throw Object.assign(new Error("git failed"), { stderr: "fatal: nope" });
    }
    const [git0] = args;
    const cwd = opts?.cwd ?? "";
    if (git0 === "clone") {
      const staging = args[args.length - 1]!;
      mkdirSync(join(staging, ".git"), { recursive: true });
      state.currentRef = args[args.indexOf("--branch") + 1]!;
      writeSkill(staging, state.currentRef);
      return "";
    }
    if (git0 === "sparse-checkout") {
      mkdirSync(join(cwd, "skills"), { recursive: true });
      return "";
    }
    if (git0 === "remote") {
      if (args[1] === "set-url") state.origin = args[3]!;
      return `${state.origin}\n`;
    }
    if (git0 === "fetch") {
      state.fetchedRef = refOf(args[args.length - 1]!);
      return "";
    }
    if (git0 === "checkout") {
      const target = args[args.length - 1]!;
      state.currentRef = target === "FETCH_HEAD" ? state.fetchedRef : refOf(target);
      writeSkill(cwd, state.currentRef);
      return "";
    }
    if (git0 === "rev-parse") {
      const what = args[1]!;
      if (what === "HEAD") return `${shaOf(state.divergeHead ? "v2" : state.currentRef)}\n`;
      if (what === "FETCH_HEAD") return `${shaOf(state.fetchedRef)}\n`;
      return `${shaOf(refOf(what))}\n`;
    }
    return "";
  }),
}));

const cacheRoot = mkdtempSync(join(tmpdir(), "hf-mirror-"));
const formatDir = join(cacheRoot, "skills-repo", "1");
const mirrorDir = join(formatDir, "mirror");
const snapshotsDir = join(formatDir, "snapshots");
const url = "https://github.com/heygen-com/hyperframes";

async function load() {
  return import("./skillsRepoMirror.js");
}

/** A checkout on disk, as a previous run leaves it. */
function seedCheckout(ref: string): void {
  mkdirSync(join(mirrorDir, ".git"), { recursive: true });
  writeSkill(mirrorDir, ref);
  state.origin = url;
  state.currentRef = ref;
}

function gitCommands(): string[] {
  return state.calls.filter((call) => call.args.length > 0).map((call) => call.args[0]!);
}

describe("ensureSkillsRepoMirror", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", cacheRoot);
    vi.stubEnv("HYPERFRAMES_SKILLS_MIRROR", "");
    state.calls = [];
    state.failOn = undefined;
    state.origin = url;
    state.currentRef = "";
    state.fetchedRef = "";
    state.divergeHead = false;
    rmSync(formatDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a blobless sparse checkout of just skills/, then snapshots it", async () => {
    const { ensureSkillsRepoMirror } = await load();
    const result = ensureSkillsRepoMirror({ url, ref: "main" });

    expect(result).toEqual({
      dir: join(snapshotsDir, SHA.main!),
      created: true,
    });
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
      url,
    ]);
    expect(state.calls[1]!.args).toEqual(["sparse-checkout", "set", "skills"]);
    expect(existsSync(join(result!.dir, "skills", "hyperframes", "SKILL.md"))).toBe(true);
    // The staging dirs it cloned/copied into are renamed into place, never left behind.
    expect(existsSync(`${mirrorDir}.partial-${process.pid}`)).toBe(false);
    expect(existsSync(`${result!.dir}.partial-${process.pid}`)).toBe(false);
  });

  it("fetches the delta into an existing checkout instead of re-cloning", async () => {
    const { ensureSkillsRepoMirror } = await load();
    seedCheckout("main");

    const result = ensureSkillsRepoMirror({ url, ref: "main" });

    expect(result?.dir).toBe(join(snapshotsDir, SHA.main!));
    expect(gitCommands()).toEqual(["remote", "fetch", "rev-parse", "checkout", "rev-parse"]);
    expect(state.calls[1]!.args).toEqual([
      "fetch",
      "--quiet",
      "--depth=1",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ]);
    expect(gitCommands()).not.toContain("clone");
  });

  it("reuses the snapshot for a commit it already published", async () => {
    const { ensureSkillsRepoMirror } = await load();
    const first = ensureSkillsRepoMirror({ url, ref: "main" });
    seedCheckout("main");

    const second = ensureSkillsRepoMirror({ url, ref: "main" });

    expect(second).toEqual({ dir: first!.dir, created: false });
  });

  it("checks out a release tag when the check resolved one", async () => {
    const { ensureSkillsRepoMirror } = await load();
    seedCheckout("v1");

    ensureSkillsRepoMirror({ url, ref: "v1" });

    expect(state.calls.map((call) => call.args)).toContainEqual([
      "fetch",
      "--quiet",
      "--depth=1",
      "origin",
      "+refs/tags/v1:refs/tags/v1",
    ]);
    expect(state.calls.map((call) => call.args)).toContainEqual([
      "checkout",
      "--quiet",
      "--force",
      "refs/tags/v1",
    ]);
  });

  // A second invocation refreshing the shared checkout to another tag must not
  // change what the first installer reads: it installs from its own snapshot.
  it("keeps an install on the bytes of the ref it asked for", async () => {
    const { ensureSkillsRepoMirror } = await load();
    const first = ensureSkillsRepoMirror({ url, ref: "v1" })!;
    const installer = join(first.dir, "skills", "hyperframes", "SKILL.md");
    expect(readFileSync(installer, "utf8")).toBe(CONTENT("v1"));

    const second = ensureSkillsRepoMirror({ url, ref: "v2" });

    expect(second?.dir).not.toBe(first.dir);
    expect(readFileSync(installer, "utf8")).toBe(CONTENT("v1"));
    // The shared checkout did move on — only the published snapshot is frozen.
    expect(readFileSync(join(mirrorDir, "skills", "hyperframes", "SKILL.md"), "utf8")).toBe(
      CONTENT("v2"),
    );
  });

  it("returns null (caller falls back to the URL clone) when git fails", async () => {
    const { ensureSkillsRepoMirror } = await load();
    seedCheckout("main");
    state.failOn = "fetch";

    expect(ensureSkillsRepoMirror({ url, ref: "main" })).toBeNull();
  });

  it("returns null when the checkout does not land on the fetched commit", async () => {
    const { ensureSkillsRepoMirror } = await load();
    seedCheckout("main");
    // `fetch` resolves one commit, the checkout ends up on another.
    state.divergeHead = true;

    expect(ensureSkillsRepoMirror({ url, ref: "main" })).toBeNull();
  });

  it("refuses a ref that could smuggle a flag or a transport", async () => {
    const { ensureSkillsRepoMirror } = await load();
    for (const ref of ["--upload-pack=evil", "ext::sh -c whoami", "a b"]) {
      expect(ensureSkillsRepoMirror({ url, ref })).toBeNull();
    }
    expect(state.calls).toEqual([]);
    // A blank ref is not a ref — it falls back to main, the default install ref.
    expect(ensureSkillsRepoMirror({ url, ref: "  " })).not.toBeNull();
    expect(state.calls[0]?.args).toContain("main");
  });

  it("can be switched off for diagnosis", async () => {
    const { ensureSkillsRepoMirror } = await load();
    vi.stubEnv("HYPERFRAMES_SKILLS_MIRROR", "0");

    expect(ensureSkillsRepoMirror({ url, ref: "main" })).toBeNull();
    expect(state.calls).toEqual([]);
  });

  // An existing checkout is git metadata (config, hooks) plus skill bytes that
  // feed global agent instructions: a cache the core policy refuses must not be
  // consumed — and must not reach git at all.
  it("refuses an existing checkout another account can write to, without running git", async () => {
    const { ensureSkillsRepoMirror } = await load();
    seedCheckout("main");
    chmodSync(join(mirrorDir, "skills", "hyperframes", "SKILL.md"), 0o666);
    state.calls = [];

    expect(ensureSkillsRepoMirror({ url, ref: "main" })).toBeNull();
    expect(state.calls).toEqual([]);
  });

  it("refuses a cold build into a cache root another account can write to", async () => {
    const { ensureSkillsRepoMirror } = await load();
    chmodSync(cacheRoot, 0o777);

    expect(ensureSkillsRepoMirror({ url, ref: "main" })).toBeNull();
    expect(state.calls).toEqual([]);
  });
});

describe("publishedSkillNames", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", cacheRoot);
    rmSync(formatDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists one name per skill directory in the snapshot", async () => {
    const { publishedSkillNames } = await load();
    const dir = join(snapshotsDir, SHA.main!);
    writeSkill(dir, "main");
    mkdirSync(join(dir, "skills", "no-skill-md"), { recursive: true });

    expect(publishedSkillNames(dir)).toEqual(["hyperframes"]);
    expect(publishedSkillNames(undefined)).toEqual([]);
    expect(publishedSkillNames(join(dir, "missing"))).toEqual([]);
  });
});

describe("isSkillsRepoMirrorPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("recognises the mirror tree, its snapshots, and nothing else", async () => {
    vi.resetModules();
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", cacheRoot);
    const { isSkillsRepoMirrorPath } = await load();

    expect(isSkillsRepoMirrorPath(mirrorDir)).toBe(true);
    expect(isSkillsRepoMirrorPath(join(snapshotsDir, SHA.main!))).toBe(true);
    expect(isSkillsRepoMirrorPath(`${formatDir}-backup`)).toBe(false);
    expect(isSkillsRepoMirrorPath(join(cacheRoot, "somewhere-else"))).toBe(false);
    expect(isSkillsRepoMirrorPath("/home/someone/checkout")).toBe(false);
    expect(isSkillsRepoMirrorPath(undefined)).toBe(false);
  });
});
