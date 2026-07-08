// ESM forbids `vi.spyOn` on live module exports, so we mock
// `node:child_process` at the loader level and inspect the spawned
// child's env.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

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
// two stale core skills, leave `pr-to-video` alone (on demand), and keep
// `embedded-captions` (installed + current) untouched.
const DEFAULT_CHECK = {
  location: "/home/user/.claude/skills",
  agent: "claude-code",
  scope: "global",
  updateAvailable: true,
  summary: { current: 1, outdated: 1, missing: 2, coreMissing: 1, removed: 0 },
  skills: [
    { name: "hyperframes", status: "outdated" },
    { name: "hyperframes-core", status: "missing" },
    { name: "embedded-captions", status: "current" },
    { name: "pr-to-video", status: "missing" },
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
  mirrorGlobalSkills: vi.fn(() => ({ source: null, mirrored: [] })),
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
  name: "update",
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
  let prevExitCode: typeof process.exitCode;

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
    // Each test asserts on process.exitCode; isolate it from the runner's own.
    prevExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
    process.exitCode = prevExitCode;
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
        "*",
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
        "*",
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
        "*",
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
    expect(process.exitCode).toBe(1);
  });

  it("skills update refreshes only the stale core + installed skills — never the full set", async () => {
    setPlatform("linux");
    await runSkillsUpdate();
    expect(process.exitCode).toBe(0);
    const args = state.spawnCalls[0]?.args ?? [];
    // straight from GitHub, globally, as a faithful clone
    expect(args).toContain("https://github.com/heygen-com/hyperframes");
    expect(args).toContain("--global");
    expect(args).toContain("--copy");
    expect(args).toContain("--full-depth");
    // targeted per-name selection: the stale core skills only
    expect(skillFlagValues(args).sort()).toEqual(["hyperframes", "hyperframes-core"]);
    // never the full-set wildcard, and never a missing on-demand workflow
    expect(skillFlagValues(args)).not.toContain("*");
    expect(skillFlagValues(args)).not.toContain("pr-to-video");
    // installed-and-current skills are not re-fetched
    expect(skillFlagValues(args)).not.toContain("embedded-captions");
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
        { name: "embedded-captions", status: "outdated" }, // installed workflow → refresh
        { name: "pr-to-video", status: "missing" }, // not installed → leave for on-demand
      ],
    } as never);

    await runSkillsUpdate();

    const args = state.spawnCalls[0]?.args ?? [];
    expect(skillFlagValues(args)).toEqual(["embedded-captions"]);
  });

  it("skills update is a no-install no-op when everything is current", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockResolvedValue({
      ...DEFAULT_CHECK,
      updateAvailable: false,
      skills: [
        { name: "hyperframes", status: "current" },
        { name: "pr-to-video", status: "missing" }, // on demand — not an update
      ],
    } as never);

    await runSkillsUpdate();

    expect(state.spawnCalls.some((s) => s.args.includes("add"))).toBe(false);
    expect(process.exitCode).toBe(0);
  });

  // `skills add` never deletes, so update must separately prune skills the
  // manifest dropped (renames/removals) for `check || update` to fully reconcile.
  it("skills update prunes skills removed upstream, in the attributed scope", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    // First call feeds the targeted install; the second is the prune detection.
    vi.mocked(checkSkills)
      .mockResolvedValueOnce(DEFAULT_CHECK as never)
      .mockResolvedValueOnce({
        scope: "global",
        skills: [{ name: "graphic-overlays", status: "removed" }],
      } as never);

    await runSkillsUpdate();

    // install first, then a `skills remove` for the dropped skill
    expect(state.spawnCalls[0]?.args).toContain("add");
    const removeCall = state.spawnCalls.find((s) => s.args.includes("remove"));
    expect(removeCall, "expected a `skills remove` spawn").toBeDefined();
    expect(removeCall!.args).toContain("graphic-overlays");
    expect(removeCall!.args).toContain("--yes");
    expect(removeCall!.args).toContain("-g"); // attributed from the global lock → remove globally
    expect(process.exitCode).toBe(0);
  });

  // The scope the skill was attributed from drives the remove scope: a
  // project-scoped removal must NOT pass -g (which would target a different,
  // possibly user-owned, global skill of the same name).
  it("skills update prunes in project scope without -g", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills)
      .mockResolvedValueOnce(DEFAULT_CHECK as never)
      .mockResolvedValueOnce({
        scope: "project",
        skills: [{ name: "graphic-overlays", status: "removed" }],
      } as never);

    await runSkillsUpdate();

    const removeCall = state.spawnCalls.find((s) => s.args.includes("remove"));
    expect(removeCall, "expected a `skills remove` spawn").toBeDefined();
    expect(removeCall!.args).toContain("graphic-overlays");
    expect(removeCall!.args).not.toContain("-g");
  });

  it("skills update does not prune when nothing was removed upstream", async () => {
    setPlatform("linux");
    await runSkillsUpdate();
    expect(state.spawnCalls.some((s) => s.args.includes("remove"))).toBe(false);
  });

  // `update`'s prune runs the same removed-detection as `check`, so its
  // --source/--dir must reach the internal checkSkills() — otherwise the prune
  // reconciles against defaults even when the user pointed elsewhere.
  it("skills update plumbs --source/--dir to its prune detection (parity with check)", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");

    await runSkillsUpdate({ source: "owner/repo", dir: "/custom/skills" });

    // The last checkSkills call is the prune's — the update engine's own check
    // (first call) intentionally uses default detection, matching where the
    // install actually lands.
    expect(checkSkills).toHaveBeenLastCalledWith({ source: "owner/repo", dir: "/custom/skills" });
  });

  // Skill names come from lock-file JSON keys; a flag-like / shell-special name
  // must never reach the spawn (esp. the Windows cmd.exe path).
  it("skills update never passes a non-slug skill name to remove", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills)
      .mockResolvedValueOnce(DEFAULT_CHECK as never)
      .mockResolvedValueOnce({
        scope: "global",
        skills: [
          { name: "graphic-overlays", status: "removed" },
          { name: "--config=evil.js", status: "removed" },
        ],
      } as never);

    await runSkillsUpdate();

    const removeCall = state.spawnCalls.find((s) => s.args.includes("remove"));
    expect(removeCall, "expected a `skills remove` spawn for the valid name").toBeDefined();
    expect(removeCall!.args).toContain("graphic-overlays");
    expect(removeCall!.args).not.toContain("--config=evil.js");
  });

  // The early-return guard in runSkillsRemove: when EVERY candidate name is
  // rejected as non-slug, no `skills remove` is spawned at all (the prior test
  // only covers a mix of valid + invalid). A spawn here would run `skills remove
  // --yes` with no names — which the upstream CLI treats as "remove nothing" at
  // best, or prompts interactively at worst — so we must not reach it.
  it("skills update spawns no remove when every removed name is rejected", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills)
      .mockResolvedValueOnce(DEFAULT_CHECK as never)
      .mockResolvedValueOnce({
        scope: "global",
        skills: [
          { name: "--config=evil.js", status: "removed" },
          { name: "../escape", status: "removed" },
        ],
      } as never);

    await runSkillsUpdate();

    expect(state.spawnCalls.some((s) => s.args.includes("remove"))).toBe(false);
    // The install still ran and the update still succeeded — a cleanup no-op
    // doesn't fail the update.
    expect(state.spawnCalls[0]?.args).toContain("add");
    expect(process.exitCode).toBe(0);
  });

  // When git is missing the upstream `skills add` would clone-abort with a noisy
  // `spawn git ENOENT` block. Detect it first and never spawn the install, so a
  // best-effort caller (init) skips cleanly and a fresh boot without git still
  // scaffolds the project.
  it("bare `skills` skips the install (no spawn) when git is unavailable", async () => {
    setPlatform("linux");
    state.gitMissing = true;

    const { default: skillsCmd } = await import("./skills.js");
    await skillsCmd.run?.({ args: {}, rawArgs: [], cmd: skillsCmd } as never);

    expect(state.spawnCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
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
    expect(process.exitCode).toBe(1);
  });
});

// The router contract: `/hyperframes` picks a workflow, then runs
// `hyperframes skills update <workflow>` so the workflow's skill (and the core
// set it depends on) is guaranteed present and current before the agent reads
// it. Positional names are the ONLY way update expands an install.
describe("hyperframes skills update <names>", () => {
  let prevExitCode: typeof process.exitCode;

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
    prevExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
    process.exitCode = prevExitCode;
  });

  it("installs the requested workflow plus the stale core set — nothing else", async () => {
    setPlatform("linux");
    await runSkillsUpdateWith(["pr-to-video"]);

    expect(process.exitCode).toBe(0);
    const args = state.spawnCalls[0]?.args ?? [];
    expect(args).toContain("add");
    // requested workflow (missing) + the stale core skills; embedded-captions
    // (installed + current) and the full-set wildcard must not appear.
    expect(skillFlagValues(args).sort()).toEqual([
      "hyperframes",
      "hyperframes-core",
      "pr-to-video",
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
        { name: "hyperframes-core", status: "current" },
        { name: "pr-to-video", status: "current" },
      ],
    } as never);

    await runSkillsUpdateWith(["pr-to-video"]);

    expect(state.spawnCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("fails loudly on a skill name the manifest doesn't ship", async () => {
    setPlatform("linux");
    await runSkillsUpdateWith(["graphic-overlays"]); // renamed upstream → unknown

    expect(state.spawnCalls).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });

  it("rejects flag-like skill names before any spawn", async () => {
    setPlatform("linux");
    await runSkillsUpdateWith(["--config=evil.js"]);

    expect(state.spawnCalls).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });

  it("offline with the skill already on disk: proceeds without installing", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockRejectedValue(new Error("offline"));

    await runSkillsUpdateWith(["pr-to-video"]);

    expect(state.spawnCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
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

    await runSkillsUpdateWith(["pr-to-video"]);

    // The offline guarantee must still cover the core tier the workflow
    // depends on, not silently shrink to just the named skill.
    const args = state.spawnCalls[0]?.args ?? [];
    expect(skillFlagValues(args).sort()).toEqual(["pr-to-video", ...FALLBACK_CORE_SKILLS].sort());
    expect(process.exitCode).toBe(0);
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
    expect(process.exitCode).toBe(1);
  });

  it("--json emits a parseable result on success", async () => {
    setPlatform("linux");
    const logSpy = vi.spyOn(console, "log");

    await runSkillsUpdateWith(["pr-to-video"], { json: true });

    expect(process.exitCode).toBe(0);
    // The engine logs install progress lines too; the JSON result is the last
    // console.log of the run (the prune prints nothing when nothing was removed).
    const last = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
    const parsed = JSON.parse(last) as { installed?: string[] };
    expect(parsed.installed).toContain("pr-to-video");
  });

  it("--json emits a parseable error object on failure", async () => {
    setPlatform("linux");
    const logSpy = vi.spyOn(console, "log");

    await runSkillsUpdateWith(["graphic-overlays"], { json: true }); // unknown name

    expect(process.exitCode).toBe(1);
    const last = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
    const parsed = JSON.parse(last) as { error?: string };
    expect(parsed.error).toMatch(/Unknown skill/);
  });

  it("exits non-zero when the targeted install fails", async () => {
    setPlatform("linux");
    state.spawnExitCode = 1;

    await runSkillsUpdateWith(["pr-to-video"]);

    expect(process.exitCode).toBe(1);
  });

  it("exits non-zero when the skill is still missing after an install that exited 0", async () => {
    setPlatform("linux");
    const { presentSkills } = await import("../utils/skillsManifest.js");
    // The install claims success but delivers nothing.
    vi.mocked(presentSkills).mockImplementation(() => []);

    await runSkillsUpdateWith(["pr-to-video"]);

    expect(state.spawnCalls[0]?.args).toContain("add");
    expect(process.exitCode).toBe(1);
  });
});
