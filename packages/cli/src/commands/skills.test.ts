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

  it("sets GIT_CLONE_PROTECTION_ACTIVE=0 on the spawned skills CLI child (GH #316)", async () => {
    setPlatform("linux");

    const { default: skillsCmd } = await import("./skills.js");
    await skillsCmd.run?.({ args: {}, rawArgs: [], cmd: skillsCmd } as never);

    const first = state.spawnCalls[0];
    expect(first).toBeDefined();
    expect(first!.command).toBe("npx");
    expect(first!.args).toContain("skills");
    expect(first!.args).toContain("add");
    expect(first!.env?.GIT_CLONE_PROTECTION_ACTIVE).toBe("0");
  });

  it.each([
    [
      "linux",
      "npx",
      ["--version"],
      ["skills", "add", "https://github.com/heygen-com/hyperframes", "--all"],
    ],
    [
      "darwin",
      "npx",
      ["--version"],
      ["skills", "add", "https://github.com/heygen-com/hyperframes", "--all"],
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
        "--all",
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

    const prevExit = process.exitCode;
    process.exitCode = 0;
    try {
      const { default: skillsCmd } = await import("./skills.js");
      const subs = skillsCmd.subCommands as unknown as Record<string, typeof skillsCmd>;
      const updateCmd = subs.update;
      expect(updateCmd).toBeDefined();
      await updateCmd!.run?.({ args: {}, rawArgs: [], cmd: updateCmd } as never);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prevExit;
    }
  });

  it("skills update exits zero on a successful install", async () => {
    setPlatform("linux");
    state.spawnExitCode = 0;

    const prevExit = process.exitCode;
    process.exitCode = 0;
    try {
      const { default: skillsCmd } = await import("./skills.js");
      const subs = skillsCmd.subCommands as unknown as Record<string, typeof skillsCmd>;
      const updateCmd = subs.update;
      expect(updateCmd).toBeDefined();
      await updateCmd!.run?.({ args: {}, rawArgs: [], cmd: updateCmd } as never);
      expect(process.exitCode).toBe(0);
      // pulls the full set straight from GitHub
      expect(state.spawnCalls[0]?.args).toContain("https://github.com/heygen-com/hyperframes");
      expect(state.spawnCalls[0]?.args).toContain("--all");
    } finally {
      process.exitCode = prevExit;
    }
  });
});
