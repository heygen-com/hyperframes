// ESM forbids `vi.spyOn` on live module exports, so we mock
// `node:child_process` at the loader level and inspect the spawned
// child's env.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

async function commandExitCode(): Promise<number> {
  const { consumeCommandResult } = await import("../utils/commandResult.js");
  return consumeCommandResult().exitCode;
}

async function resetCommandResult(): Promise<void> {
  const { consumeCommandResult } = await import("../utils/commandResult.js");
  consumeCommandResult();
}

type SpawnCall = {
  command: string;
  args: ReadonlyArray<string>;
  env: NodeJS.ProcessEnv | undefined;
};

type ExecCall = {
  command: string;
  args: ReadonlyArray<string>;
};

const originalPlatform = process.platform;
const state: {
  execCalls: ExecCall[];
  spawnCalls: SpawnCall[];
  spawnExitCode: number;
  gitMissing: boolean;
} = {
  execCalls: [],
  spawnCalls: [],
  spawnExitCode: 0,
  gitMissing: false,
};

vi.mock("node:child_process", () => ({
  // `skillsManifest.ts` does `promisify(execFile)` at module load. These tests
  // never invoke it (no skills-check path runs here), so a bare stub is enough
  // to satisfy the named import — we deliberately don't spread the real module.
  execFile: vi.fn(),
  execFileSync: vi.fn((command: string, args: ReadonlyArray<string>) => {
    state.execCalls.push({ command, args });
    // Simulate `git` absent from PATH: execFileSync throws ENOENT like the OS would.
    if (state.gitMissing && command === "git") {
      throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    }
    return Buffer.from("11.0.0");
  }),
  spawn: vi.fn(
    (command: string, args: ReadonlyArray<string>, opts?: { env?: NodeJS.ProcessEnv }) => {
      state.spawnCalls.push({ command, args, env: opts?.env });
      const fake = new EventEmitter();
      setImmediate(() => fake.emit("close", state.spawnExitCode, null));
      return fake;
    },
  ),
}));

vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Capture the prerequisite-skip telemetry event without touching the real
// PostHog client. trackSkillsInstallSkipped already gates on the telemetry
// opt-out inside trackEvent, so the command calls it unconditionally.
const trackSkillsInstallSkipped = vi.fn();
vi.mock("../telemetry/events.js", () => ({
  trackSkillsInstallSkipped: (...args: unknown[]) => trackSkillsInstallSkipped(...args),
}));

// A realistic check result for the targeted paths (`update`, with or without names):
// one core skill outdated, one core missing, one on-demand workflow installed
// and current, one on-demand workflow not installed. `update` must refresh the
// two stale core skills, leave `slideshow` alone (on demand), and keep
// `figma` (installed + current) untouched.
const DEFAULT_CHECK = {
  location: "/home/user/.claude/skills",
  agent: "claude-code",
  scope: "global",
  updateAvailable: true,
  summary: { current: 1, outdated: 1, missing: 2, coreMissing: 1, removed: 0 },
  skills: [
    { name: "hyperframes", status: "outdated" },
    { name: "hyperframes-registry", status: "missing" },
    { name: "figma", status: "current" },
    { name: "slideshow", status: "missing" },
  ],
  lockMissing: false,
};

// Mock only the impure exports; keep the real isCoreSkill (pure classifier).
// presentSkills echoes its input so the post-install presence verification
// passes without touching the real filesystem.
vi.mock("../utils/skillsManifest.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/skillsManifest.js")>();
  return {
    ...actual,
    checkSkills: vi.fn(async () => DEFAULT_CHECK),
    hyperframesSkillNames: vi.fn(() => ["hyperframes"]),
    presentSkills: vi.fn((names: readonly string[]) => [...names]),
  };
});

// The install fans out to other agents via mirrorGlobalSkills, which touches
// the real $HOME. Stub it so these arg-shape tests never create symlinks in the
// dev machine's agent dirs — the mirror has its own isolated-HOME unit tests.
vi.mock("../utils/skillsMirror.js", () => ({
  mirrorGlobalSkills: vi.fn(() => ({ source: null, mirrored: [], skipped: [] })),
}));

// The reconcile commands drop the background nudge's cached verdict on
// success (the stale-24h-cache fix). Stub it so these tests never touch the
// dev machine's real ~/.hyperframes config; the invalidation behavior itself
// is unit-tested in skillsUpdateCheck.test.ts.
const invalidateSkillsCache = vi.fn();
vi.mock("../utils/skillsUpdateCheck.js", () => ({
  invalidateSkillsCache: (...args: unknown[]) => invalidateSkillsCache(...args),
}));

// The global install command this CLI runs (after `skills add <url>` and the
// per-name `--skill` selection).
const GLOBAL_ARGS_TAIL = [
  "--global",
  "--agent",
  "claude-code",
  "universal",
  "--copy",
  "--full-depth",
  "--yes",
] as const;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

/** Invoke a `skills <name>` subcommand from a freshly-imported module. */
async function runSkillsSub(
  name: "update" | "check",
  args: Record<string, unknown> = {},
  positionals: string[] = [],
): Promise<void> {
  const { default: skillsCmd } = await import("./skills.js");
  const subs = skillsCmd.subCommands as unknown as Record<string, typeof skillsCmd>;
  expect(subs[name]).toBeDefined();
  await subs[name]!.run?.({
    args: { _: positionals, ...args },
    rawArgs: positionals,
    cmd: subs[name],
  } as never);
}

const runSkillsUpdate = (args: Record<string, unknown> = {}): Promise<void> =>
  runSkillsSub("update", args);
const runSkillsUpdateWith = (
  positionals: string[],
  args: Record<string, unknown> = {},
): Promise<void> => runSkillsSub("update", args, positionals);

/** The `--skill` values of a spawned `skills add` call. */
function skillFlagValues(args: ReadonlyArray<string>): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skill") values.push(args[i + 1] ?? "");
  }
  return values;
}

describe("hyperframes skills", () => {
  beforeEach(async () => {
    state.execCalls = [];
    state.spawnCalls = [];
    state.spawnExitCode = 0;
    state.gitMissing = false;
    trackSkillsInstallSkipped.mockClear();
    vi.resetModules();
    // vi.resetModules re-imports skills.js but the manifest mock's vi.fn
    // instances persist — restore their default behavior for each test.
    const { checkSkills, presentSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockReset();
    vi.mocked(checkSkills).mockImplementation(async () => DEFAULT_CHECK as never);
    vi.mocked(presentSkills).mockReset();
    vi.mocked(presentSkills).mockImplementation((names: readonly string[]) => [...names]);
    await resetCommandResult();
  });

  afterEach(async () => {
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
    await resetCommandResult();
  });

  it("sets clone-safe env on the spawned skills CLI child (GH #316 + LFS skip)", async () => {
    setPlatform("linux");

    const { default: skillsCmd } = await import("./skills.js");
    await skillsCmd.run?.({ args: {}, rawArgs: [], cmd: skillsCmd } as never);

    const first = state.spawnCalls[0];
    expect(first).toBeDefined();
    expect(first!.command).toBe("npx");
    expect(first!.args).toContain("skills");
    expect(first!.args).toContain("add");
    expect(first!.env?.GIT_CLONE_PROTECTION_ACTIVE).toBe("0");
    // --full-depth clones the repo; skip LFS so we don't drag in unrelated blobs.
    expect(first!.env?.GIT_LFS_SKIP_SMUDGE).toBe("1");
  });

  it.each([
    [
      "linux",
      "npx",
      ["--version"],
      [
        "skills",
        "add",
        "https://github.com/heygen-com/hyperframes",
        "--skill",
        "hyperframes",
        "--skill",
        "hyperframes-registry",
        "--skill",
        "slideshow",
        ...GLOBAL_ARGS_TAIL,
      ],
    ],
    [
      "darwin",
      "npx",
      ["--version"],
      [
        "skills",
        "add",
        "https://github.com/heygen-com/hyperframes",
        "--skill",
        "hyperframes",
        "--skill",
        "hyperframes-registry",
        "--skill",
        "slideshow",
        ...GLOBAL_ARGS_TAIL,
      ],
    ],
    [
      "win32",
      "cmd.exe",
      ["/d", "/s", "/c", "npx.cmd", "--version"],
      [
        "/d",
        "/s",
        "/c",
        "npx.cmd",
        "skills",
        "add",
        "https://github.com/heygen-com/hyperframes",
        "--skill",
        "hyperframes",
        "--skill",
        "hyperframes-registry",
        "--skill",
        "slideshow",
        ...GLOBAL_ARGS_TAIL,
      ],
    ],
  ] as const)(
    "uses %s-compatible npx command for preflight and the full install",
    async (platform, expectedCommand, expectedPreflightArgs, expectedInstallArgs) => {
      setPlatform(platform);

      const { default: skillsCmd } = await import("./skills.js");
      await skillsCmd.run?.({ args: {}, rawArgs: [], cmd: skillsCmd } as never);

      expect(state.execCalls[0]?.command).toBe(expectedCommand);
      expect(state.execCalls[0]?.args).toEqual(expectedPreflightArgs);
      expect(state.spawnCalls[0]?.command).toBe(expectedCommand);
      expect(state.spawnCalls[0]?.args).toEqual(expectedInstallArgs);
    },
  );

  // The `skills check || skills update` recovery contract requires update to
  // fail loudly — a swallowed install failure would let the `||` chain pass
  // while nothing changed.
  it("skills update exits non-zero when the install fails", async () => {
    setPlatform("linux");
    state.spawnExitCode = 1; // simulate `skills add` exiting non-zero
    await runSkillsUpdate();
    expect(await commandExitCode()).toBe(1);
  });

  it("skills update refreshes only the stale core + installed skills — never the full set", async () => {
    setPlatform("linux");
    await runSkillsUpdate();
    expect(await commandExitCode()).toBe(0);
    const args = state.spawnCalls[0]?.args ?? [];
    // straight from GitHub, globally, as a faithful clone
    expect(args).toContain("https://github.com/heygen-com/hyperframes");
    expect(args).toContain("--global");
    expect(args).toContain("--copy");
    expect(args).toContain("--full-depth");
    // targeted per-name selection: the stale core skills only
    expect(skillFlagValues(args).sort()).toEqual(["hyperframes", "hyperframes-registry"]);
    // never the full-set wildcard, and never a missing on-demand workflow
    expect(skillFlagValues(args)).not.toContain("*");
    expect(skillFlagValues(args)).not.toContain("slideshow");
    // installed-and-current skills are not re-fetched
    expect(skillFlagValues(args)).not.toContain("figma");
    // never the `--all` (= `--agent '*'`) spray
    expect(args).not.toContain("--all");
    // `--agent` must be followed by a concrete key, never the `'*'` wildcard
    const agentValue = args[args.indexOf("--agent") + 1];
    expect(agentValue).not.toBe("*");
  });

  it("skills update refreshes an outdated installed workflow (but never expands)", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockResolvedValueOnce({
      ...DEFAULT_CHECK,
      skills: [
        { name: "hyperframes", status: "current" },
        { name: "figma", status: "outdated" }, // installed workflow → refresh
        { name: "slideshow", status: "missing" }, // not installed → leave for on-demand
      ],
    } as never);

    await runSkillsUpdate();

    const args = state.spawnCalls[0]?.args ?? [];
    expect(skillFlagValues(args)).toEqual(["figma"]);
  });

  it("skills update is a no-install no-op when everything is current", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockResolvedValue({
      ...DEFAULT_CHECK,
      updateAvailable: false,
      skills: [
        { name: "hyperframes", status: "current" },
        { name: "slideshow", status: "missing" }, // on demand — not an update
      ],
    } as never);

    await runSkillsUpdate();

    expect(state.spawnCalls.some((s) => s.args.includes("add"))).toBe(false);
    expect(await commandExitCode()).toBe(0);
  });

  // `skills add` never deletes, so update must separately prune skills the
  // manifest dropped (renames/removals) for `check || update` to fully reconcile.
  it("skills update never removes a skill, even one check once called retired", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockImplementation(
      async () =>
        ({
          ...DEFAULT_CHECK,
          skills: [...DEFAULT_CHECK.skills, { name: "graphic-overlays", status: "removed" }],
        }) as never,
    );

    await runSkillsUpdate();

    expect(state.spawnCalls.some((s) => s.args.includes("remove"))).toBe(false);
    expect(await commandExitCode()).toBe(0);
  });

  it("updateSkills with onlyMissing installs what is missing and leaves outdated skills alone", async () => {
    setPlatform("linux");
    const { updateSkills } = await import("./skills.js");

    const result = await updateSkills({ onlyMissing: true });

    expect(result.installed).toEqual(["hyperframes-registry"]);
    expect(skillFlagValues(state.spawnCalls[0]?.args ?? [])).toEqual(["hyperframes-registry"]);
  });

  it("checks freshness against the canonical manifest, never a possibly-stale local one", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");

    await runSkillsUpdate();

    // The update engine's own check (first call) must ask for canonical. So
    // must the prune's (see the GH #3111 regression below) — every caller that
    // decides what is "still published" resolves the same way.
    expect(checkSkills).toHaveBeenNthCalledWith(1, expect.objectContaining({ canonical: true }));
  });

  // GH #3111 — silent, permanent data loss. The prune deletes; its notion of
  // "no longer published" must therefore come from the canonical repo, never
  // from resolveLatestManifest's findRepoManifest shortcut, which accepts any
  // `skills-manifest.json` within 16 parent directories of cwd. HyperFrames'
  // own manifest declares `source: heygen-com/hyperframes`, so such a file
  // matches lock attribution, and every published skill missing from it is
  // removed from every agent dir on the machine.
  //
  // Reproduced on the pre-fix build: running `skills update` from a hyperframes
  // checkout whose manifest listed 19 of the 25 published skills printed
  // "Removing 6 skill(s) no longer published: captions-overlay, changelog-video,
  // cut-the-curve, motion-doctrine, oversized-cursor, seam-craft" and deleted
  // all six — every one of them currently published.
  it("bare `skills` skips the install (no spawn) when git is unavailable", async () => {
    setPlatform("linux");
    state.gitMissing = true;

    const { default: skillsCmd } = await import("./skills.js");
    await skillsCmd.run?.({ args: {}, rawArgs: [], cmd: skillsCmd } as never);

    expect(state.spawnCalls).toHaveLength(0);
    expect(await commandExitCode()).toBe(0);
    // Diagnostic instrumentation: the skip records why, so rare boxes hitting
    // this (fresh Windows without git) are visible instead of silently no-op.
    expect(trackSkillsInstallSkipped).toHaveBeenCalledWith({ reason: "git_missing" });
  });

  // The happy path must never emit the prerequisite-skip event — it's a
  // skip-only diagnostic, not a per-install signal.
  it("bare `skills` does not emit the skip event when prerequisites are present", async () => {
    setPlatform("linux");

    const { default: skillsCmd } = await import("./skills.js");
    await skillsCmd.run?.({ args: {}, rawArgs: [], cmd: skillsCmd } as never);

    expect(state.spawnCalls.length).toBeGreaterThan(0);
    expect(trackSkillsInstallSkipped).not.toHaveBeenCalled();
  });

  // The strict recovery path (`skills check || skills update`) must fail loudly
  // when git is missing, not silently no-op, else the `||` chain passes while
  // nothing got installed.
  it("skills update exits non-zero when git is unavailable", async () => {
    setPlatform("linux");
    state.gitMissing = true;

    await runSkillsUpdate();

    expect(state.spawnCalls).toHaveLength(0);
    expect(await commandExitCode()).toBe(1);
  });

  // GH #5695: the router runs `skills update <workflow>` before every workflow, so a
  // team that pins its skills and sets HYPERFRAMES_SKIP_SKILLS=1 (like `init`
  // honours) must not have that pin replaced by the latest upstream skills.
  describe("with HYPERFRAMES_SKIP_SKILLS=1", () => {
    beforeEach(() => {
      vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "1");
      invalidateSkillsCache.mockClear();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("named `skills update` leaves a pinned install alone and exits 0", async () => {
      setPlatform("linux");
      const logSpy = vi.spyOn(console, "log");
      const { checkSkills } = await import("../utils/skillsManifest.js");

      await runSkillsUpdateWith(["product-launch-video"]);

      expect(state.spawnCalls).toHaveLength(0);
      expect(vi.mocked(checkSkills)).not.toHaveBeenCalled();
      expect(invalidateSkillsCache).not.toHaveBeenCalled();
      expect(await commandExitCode()).toBe(0);
      expect(String(logSpy.mock.calls.at(-1)?.[0] ?? "")).toMatch(/managed externally/);
    });

    it("bare `skills update` does not install", async () => {
      setPlatform("linux");
      const { checkSkills } = await import("../utils/skillsManifest.js");
      vi.mocked(checkSkills).mockImplementation(
        async () =>
          ({
            ...DEFAULT_CHECK,
            skills: [...DEFAULT_CHECK.skills, { name: "graphic-overlays", status: "removed" }],
          }) as never,
      );

      await runSkillsUpdate();

      expect(state.spawnCalls).toHaveLength(0);
      expect(vi.mocked(checkSkills)).not.toHaveBeenCalled();
      expect(await commandExitCode()).toBe(0);
    });

    it("bare `skills` does not install the full set", async () => {
      setPlatform("linux");

      const { default: skillsCmd } = await import("./skills.js");
      await skillsCmd.run?.({ args: {}, rawArgs: [], cmd: skillsCmd } as never);

      expect(state.spawnCalls).toHaveLength(0);
      expect(invalidateSkillsCache).not.toHaveBeenCalled();
      expect(await commandExitCode()).toBe(0);
    });

    it("--json reports the skip as parseable JSON", async () => {
      setPlatform("linux");
      const logSpy = vi.spyOn(console, "log");

      await runSkillsUpdateWith(["pr-to-video"], { json: true });

      expect(await commandExitCode()).toBe(0);
      const parsed = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] ?? "")) as {
        skipped?: boolean;
        requested?: string[];
      };
      expect(parsed.skipped).toBe(true);
      expect(parsed.requested).toEqual(["pr-to-video"]);
    });

    it("still rejects flag-like skill names", async () => {
      setPlatform("linux");

      await runSkillsUpdateWith(["--all"]);

      expect(state.spawnCalls).toHaveLength(0);
      expect(await commandExitCode()).toBe(1);
    });
  });

  // The stale-24h-cache regression: the skills commands are excluded from the
  // background nudge pipeline (cli.ts), so unless they drop the cached verdict
  // themselves, a successful install keeps the pre-install "N out of date or
  // missing" nag alive on every other command for up to 24h.
  describe("nudge-cache invalidation", () => {
    it("skills update drops the cached nudge verdict on success", async () => {
      setPlatform("linux");
      invalidateSkillsCache.mockClear();

      await runSkillsUpdate();

      expect(await commandExitCode()).toBe(0);
      expect(invalidateSkillsCache).toHaveBeenCalled();
    });

    it("skills update keeps the cached verdict when the install fails", async () => {
      setPlatform("linux");
      invalidateSkillsCache.mockClear();
      state.spawnExitCode = 1; // `skills add` exits non-zero → strict throw

      await runSkillsUpdate();

      expect(await commandExitCode()).toBe(1);
      expect(invalidateSkillsCache).not.toHaveBeenCalled();
    });

    it("skills update keeps the cached verdict on the offline (presence-only) path", async () => {
      setPlatform("linux");
      invalidateSkillsCache.mockClear();
      const { checkSkills } = await import("../utils/skillsManifest.js");
      vi.mocked(checkSkills).mockRejectedValue(new Error("offline"));

      await runSkillsUpdate();

      // Presence-only run never learned anything about freshness — the cached
      // verdict is still the best information available.
      expect(invalidateSkillsCache).not.toHaveBeenCalled();
    });

    it("bare `skills` (full install) drops the cached nudge verdict", async () => {
      setPlatform("linux");
      invalidateSkillsCache.mockClear();

      const { default: skillsCmd } = await import("./skills.js");
      await skillsCmd.run?.({ args: {}, rawArgs: [], cmd: skillsCmd } as never);

      expect(invalidateSkillsCache).toHaveBeenCalled();
    });

    it("skills check drops the cached verdict — the fresh result supersedes it", async () => {
      setPlatform("linux");
      invalidateSkillsCache.mockClear();

      await runSkillsSub("check", { json: true });

      expect(invalidateSkillsCache).toHaveBeenCalled();
    });
  });
});

// The router contract: `/hyperframes` picks a workflow, then runs
// `hyperframes skills update <workflow>` so the workflow's skill (and the core
// set it depends on) is guaranteed present and current before the agent reads
// it. Positional names are the ONLY way update expands an install.
describe("hyperframes skills update <names>", () => {
  beforeEach(async () => {
    state.execCalls = [];
    state.spawnCalls = [];
    state.spawnExitCode = 0;
    state.gitMissing = false;
    vi.resetModules();
    const { checkSkills, presentSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockReset();
    vi.mocked(checkSkills).mockImplementation(async () => DEFAULT_CHECK as never);
    vi.mocked(presentSkills).mockReset();
    vi.mocked(presentSkills).mockImplementation((names: readonly string[]) => [...names]);
    await resetCommandResult();
  });

  afterEach(async () => {
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
    await resetCommandResult();
  });

  it("installs the requested workflow plus the stale core set — nothing else", async () => {
    setPlatform("linux");
    await runSkillsUpdateWith(["slideshow"]);

    expect(await commandExitCode()).toBe(0);
    const args = state.spawnCalls[0]?.args ?? [];
    expect(args).toContain("add");
    // requested workflow (missing) + the stale core skills; figma
    // (installed + current) and the full-set wildcard must not appear.
    expect(skillFlagValues(args).sort()).toEqual([
      "hyperframes",
      "hyperframes-registry",
      "slideshow",
    ]);
  });

  it("is a fast no-op (no install spawn) when everything is already current", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockResolvedValue({
      ...DEFAULT_CHECK,
      updateAvailable: false,
      skills: [
        { name: "hyperframes", status: "current" },
        { name: "hyperframes-registry", status: "current" },
        { name: "slideshow", status: "current" },
      ],
    } as never);

    await runSkillsUpdateWith(["slideshow"]);

    expect(state.spawnCalls).toHaveLength(0);
    expect(await commandExitCode()).toBe(0);
  });

  it("a retired workflow name installs nothing, says where its knowledge went, and succeeds", async () => {
    setPlatform("linux");
    const logSpy = vi.spyOn(console, "log");
    await runSkillsUpdateWith(["product-launch-video"]);

    expect(await commandExitCode()).toBe(0);
    // The core set that now carries the knowledge is still refreshed; the
    // retired name never reaches `skills add`.
    const args = state.spawnCalls[0]?.args ?? [];
    expect(skillFlagValues(args).sort()).toEqual(["hyperframes", "hyperframes-registry"]);
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toMatch(/product-launch-video was retired/);
    expect(printed).toMatch(/\/hyperframes skill and its references/);
    expect(printed).not.toMatch(/Ready: product-launch-video/);
  });

  it("--json reports a retired name under retired, not unknown", async () => {
    setPlatform("linux");
    const logSpy = vi.spyOn(console, "log");
    await runSkillsUpdateWith(["music-to-video", "slideshow"], { json: true });

    expect(await commandExitCode()).toBe(0);
    const last = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
    const parsed = JSON.parse(last) as {
      retired?: string[];
      unknown?: string[];
      installed?: string[];
    };
    expect(parsed.retired).toEqual(["music-to-video"]);
    expect(parsed.unknown).toEqual([]);
    expect(parsed.installed).toContain("slideshow");
    expect(parsed.installed).not.toContain("music-to-video");
  });

  it("fails loudly on a skill name the manifest doesn't ship", async () => {
    setPlatform("linux");
    await runSkillsUpdateWith(["graphic-overlays"]); // renamed upstream → unknown

    expect(state.spawnCalls).toHaveLength(0);
    expect(await commandExitCode()).toBe(1);
  });

  it("rejects flag-like skill names before any spawn", async () => {
    setPlatform("linux");
    await runSkillsUpdateWith(["--config=evil.js"]);

    expect(state.spawnCalls).toHaveLength(0);
    expect(await commandExitCode()).toBe(1);
  });

  it("offline with the skill already on disk: proceeds without installing", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockRejectedValue(new Error("offline"));

    await runSkillsUpdateWith(["slideshow"]);

    expect(state.spawnCalls).toHaveLength(0);
    expect(await commandExitCode()).toBe(0);
  });

  it("offline with the skill absent: blind-installs it plus the fallback core set", async () => {
    setPlatform("linux");
    const { checkSkills, presentSkills, FALLBACK_CORE_SKILLS } =
      await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockRejectedValue(new Error("offline"));
    // Absent before the install, present after it (the blind install worked).
    vi.mocked(presentSkills)
      .mockImplementationOnce(() => [])
      .mockImplementation((names: readonly string[]) => [...names]);

    await runSkillsUpdateWith(["slideshow"]);

    // The offline guarantee must still cover the core tier the workflow
    // depends on, not silently shrink to just the named skill.
    const args = state.spawnCalls[0]?.args ?? [];
    expect(skillFlagValues(args).sort()).toEqual(["slideshow", ...FALLBACK_CORE_SKILLS].sort());
    expect(await commandExitCode()).toBe(0);
  });

  it("bare `skills` offline never falls back to the wildcard: warns and installs the pinned core set", async () => {
    setPlatform("linux");
    const { checkSkills, presentSkills, FALLBACK_CORE_SKILLS } =
      await import("../utils/skillsManifest.js");
    const clack = await import("@clack/prompts");
    vi.mocked(clack.log.warn).mockClear();
    vi.mocked(checkSkills).mockRejectedValue(new Error("offline"));
    vi.mocked(presentSkills)
      .mockImplementationOnce(() => [])
      .mockImplementation((names: readonly string[]) => [...names]);

    const { default: skillsCmd } = await import("./skills.js");
    await skillsCmd.run?.({ args: {}, rawArgs: [], cmd: skillsCmd } as never);

    const args = state.spawnCalls[0]?.args ?? [];
    // The upstream `*` would rediscover the repo-internal skills (26 vs 20).
    expect(skillFlagValues(args)).not.toContain("*");
    expect(skillFlagValues(args).sort()).toEqual([...FALLBACK_CORE_SKILLS].sort());
    expect(vi.mocked(clack.log.warn)).toHaveBeenCalledWith(
      expect.stringContaining("published skill set"),
    );
    expect(await commandExitCode()).toBe(0);
  });

  // The `check || update` CI contract: offline, a bare update can't verify
  // freshness — exiting 0 would let the chain pass while everything stays
  // stale. It must fail loudly instead.
  it("bare update offline exits non-zero instead of claiming success", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockRejectedValue(new Error("offline"));

    await runSkillsUpdate();

    expect(state.spawnCalls.some((s) => s.args.includes("add"))).toBe(false);
    expect(await commandExitCode()).toBe(1);
  });

  it("a malformed canonical manifest warns distinctly, then still degrades to presence mode", async () => {
    setPlatform("linux");
    const clack = await import("@clack/prompts");
    vi.mocked(clack.log.warn).mockClear();
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockRejectedValue(
      new Error("Malformed skills manifest from https://raw.githubusercontent.com/…"),
    );

    await runSkillsUpdateWith(["slideshow"]);

    const warnedMalformed = vi
      .mocked(clack.log.warn)
      .mock.calls.some((args) => String(args[0]).includes("malformed"));
    expect(warnedMalformed).toBe(true);
    // Still degrades rather than failing the whole command.
    expect(await commandExitCode()).toBe(0);
  });

  it("a genuine offline error degrades silently — no malformed-manifest warning", async () => {
    setPlatform("linux");
    const clack = await import("@clack/prompts");
    vi.mocked(clack.log.warn).mockClear();
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockRejectedValue(new Error("fetch failed"));

    await runSkillsUpdateWith(["slideshow"]);

    const warnedMalformed = vi
      .mocked(clack.log.warn)
      .mock.calls.some((args) => String(args[0]).includes("malformed"));
    expect(warnedMalformed).toBe(false);
  });

  it("--json emits a parseable result on success", async () => {
    setPlatform("linux");
    const logSpy = vi.spyOn(console, "log");

    await runSkillsUpdateWith(["slideshow"], { json: true });

    expect(await commandExitCode()).toBe(0);
    // The engine logs install progress lines too; the JSON result is the last
    // console.log of the run (the prune prints nothing when nothing was removed).
    const last = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
    const parsed = JSON.parse(last) as { installed?: string[] };
    expect(parsed.installed).toContain("slideshow");
  });

  it("--json emits a parseable error object on failure", async () => {
    setPlatform("linux");
    const logSpy = vi.spyOn(console, "log");

    await runSkillsUpdateWith(["graphic-overlays"], { json: true }); // unknown name

    expect(await commandExitCode()).toBe(1);
    const last = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
    const parsed = JSON.parse(last) as { error?: string };
    expect(parsed.error).toMatch(/Unknown skill/);
  });

  it("exits non-zero when the targeted install fails", async () => {
    setPlatform("linux");
    state.spawnExitCode = 1;

    await runSkillsUpdateWith(["slideshow"]);

    expect(await commandExitCode()).toBe(1);
  });

  it("exits non-zero when the skill is still missing after an install that exited 0", async () => {
    setPlatform("linux");
    const { presentSkills } = await import("../utils/skillsManifest.js");
    // The install claims success but delivers nothing.
    vi.mocked(presentSkills).mockImplementation(() => []);

    await runSkillsUpdateWith(["slideshow"]);

    expect(state.spawnCalls[0]?.args).toContain("add");
    expect(await commandExitCode()).toBe(1);
  });
});
