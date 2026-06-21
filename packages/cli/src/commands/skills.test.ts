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
const state: { execCalls: ExecCall[]; spawnCalls: SpawnCall[] } = {
  execCalls: [],
  spawnCalls: [],
};

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((command: string, args: ReadonlyArray<string>) => {
    state.execCalls.push({ command, args });
    return Buffer.from("11.0.0");
  }),
  spawn: vi.fn(
    (command: string, args: ReadonlyArray<string>, opts?: { env?: NodeJS.ProcessEnv }) => {
      state.spawnCalls.push({ command, args, env: opts?.env });
      const fake = new EventEmitter();
      setImmediate(() => fake.emit("close", 0, null));
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
    ["linux", "npx", ["--version"], ["skills", "add", "heygen-com/hyperframes", "--all"]],
    ["darwin", "npx", ["--version"], ["skills", "add", "heygen-com/hyperframes", "--all"]],
    [
      "win32",
      "cmd.exe",
      ["/d", "/s", "/c", "npx.cmd", "--version"],
      ["/d", "/s", "/c", "npx.cmd", "skills", "add", "heygen-com/hyperframes", "--all"],
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
});
