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
const state: { execCalls: ExecCall[]; spawnCalls: SpawnCall[]; spawnExitCode: number } = {
  execCalls: [],
  spawnCalls: [],
  spawnExitCode: 0,
};

vi.mock("node:child_process", () => ({
  // `skillsManifest.ts` does `promisify(execFile)` at module load. These tests
  // never invoke it (no skills-check path runs here), so a bare stub is enough
  // to satisfy the named import — we deliberately don't spread the real module.
  execFile: vi.fn(),
  execFileSync: vi.fn((command: string, args: ReadonlyArray<string>) => {
    state.execCalls.push({ command, args });
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
  },
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

describe("hyperframes skills", () => {
  beforeEach(() => {
    state.execCalls = [];
    state.spawnCalls = [];
    state.spawnExitCode = 0;
    vi.resetModules();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
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

  /** Run `skills update` with the mocked install exit code; returns the exitCode it left. */
  async function runUpdate(installExitCode: number): Promise<number | undefined> {
    state.spawnExitCode = installExitCode;
    const prevExit = process.exitCode;
    process.exitCode = 0;
    try {
      const { default: skillsCmd } = await import("./skills.js");
      const subs = skillsCmd.subCommands as unknown as Record<string, typeof skillsCmd>;
      const updateCmd = subs.update;
      expect(updateCmd).toBeDefined();
      await updateCmd!.run?.({ args: {}, rawArgs: [], cmd: updateCmd } as never);
      return process.exitCode;
    } finally {
      process.exitCode = prevExit;
    }
  }

  // The `skills check || skills update` recovery contract requires update to
  // fail loudly — a swallowed install failure would let the `||` chain pass
  // while nothing changed.
  it("skills update exits non-zero when the install fails", async () => {
    setPlatform("linux");
    expect(await runUpdate(1)).toBe(1);
  });

  it("skills update exits zero on a successful install", async () => {
    setPlatform("linux");
    expect(await runUpdate(0)).toBe(0);
    // pulls the full set straight from GitHub, globally, as a faithful copy
    expect(state.spawnCalls[0]?.args).toContain("https://github.com/heygen-com/hyperframes");
    expect(state.spawnCalls[0]?.args).toContain("--global");
    expect(state.spawnCalls[0]?.args).toContain("--copy");
    expect(state.spawnCalls[0]?.args).not.toContain("--all");
  });
});
