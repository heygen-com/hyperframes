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

// `skills update` calls checkSkills() to find skills removed upstream, then
// prunes them. Mock it so these tests don't touch the real FS / network; the
// default returns nothing removed, and the prune test overrides per-call.
vi.mock("../utils/skillsManifest.js", () => ({
  checkSkills: vi.fn(async () => ({ skills: [] })),
  // installAllSkills resolves the HyperFrames skill names (lock-attributed) to
  // scope the mirror; pin it so these arg-shape tests don't read a real lock.
  hyperframesSkillNames: vi.fn(() => ["hyperframes"]),
}));

// The install fans out to other agents via mirrorGlobalSkills, which touches
// the real $HOME. Stub it so these arg-shape tests never create symlinks in the
// dev machine's agent dirs — the mirror has its own isolated-HOME unit tests.
vi.mock("../utils/skillsMirror.js", () => ({
  mirrorGlobalSkills: vi.fn(() => ({ source: null, mirrored: [] })),
}));

// The global install command this CLI runs (after `skills add <url>`).
const GLOBAL_ARGS = [
  "--skill",
  "*",
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

/** Invoke the `skills update` subcommand from a freshly-imported module. */
async function runSkillsUpdate(args: Record<string, unknown> = {}): Promise<void> {
  const { default: skillsCmd } = await import("./skills.js");
  const subs = skillsCmd.subCommands as unknown as Record<string, typeof skillsCmd>;
  expect(subs.update).toBeDefined();
  await subs.update!.run?.({ args, rawArgs: [], cmd: subs.update } as never);
}

describe("hyperframes skills", () => {
  let prevExitCode: typeof process.exitCode;

  beforeEach(() => {
    state.execCalls = [];
    state.spawnCalls = [];
    state.spawnExitCode = 0;
    state.gitMissing = false;
    trackSkillsInstallSkipped.mockClear();
    vi.resetModules();
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
      ["skills", "add", "https://github.com/heygen-com/hyperframes", ...GLOBAL_ARGS],
    ],
    [
      "darwin",
      "npx",
      ["--version"],
      ["skills", "add", "https://github.com/heygen-com/hyperframes", ...GLOBAL_ARGS],
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
        ...GLOBAL_ARGS,
      ],
    ],
  ] as const)(
    "uses %s-compatible npx command for preflight and skills install",
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

  it("skills update exits zero on a successful install", async () => {
    setPlatform("linux");
    await runSkillsUpdate();
    expect(process.exitCode).toBe(0);
    const args = state.spawnCalls[0]?.args ?? [];
    // pulls the full set straight from GitHub, globally, as a faithful clone
    expect(args).toContain("https://github.com/heygen-com/hyperframes");
    expect(args).toContain("--global");
    expect(args).toContain("--copy");
    expect(args).toContain("--full-depth");
    // never the `--all` (= `--agent '*'`) spray
    expect(args).not.toContain("--all");
    // `--agent` must be followed by a concrete key, never the `'*'` wildcard
    const agentValue = args[args.indexOf("--agent") + 1];
    expect(agentValue).not.toBe("*");
  });

  // `skills add --all` never deletes, so update must separately prune skills the
  // manifest dropped (renames/removals) for `check || update` to fully reconcile.
  it("skills update prunes skills removed upstream, in the attributed scope", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockResolvedValueOnce({
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
    vi.mocked(checkSkills).mockResolvedValueOnce({
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
    vi.mocked(checkSkills).mockResolvedValueOnce({ scope: "project", skills: [] } as never);

    await runSkillsUpdate({ source: "owner/repo", dir: "/custom/skills" });

    expect(checkSkills).toHaveBeenCalledWith({ source: "owner/repo", dir: "/custom/skills" });
  });

  // Skill names come from lock-file JSON keys; a flag-like / shell-special name
  // must never reach the spawn (esp. the Windows cmd.exe path).
  it("skills update never passes a non-slug skill name to remove", async () => {
    setPlatform("linux");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockResolvedValueOnce({
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
    vi.mocked(checkSkills).mockResolvedValueOnce({
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
