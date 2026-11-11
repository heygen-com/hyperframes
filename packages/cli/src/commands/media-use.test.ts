import { describe, expect, it, onTestFinished, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import {
  createMediaUseCommand,
  MEDIA_USE_VERBS,
  mediaUseEngineEnv,
  mediaUsePassthroughArgs,
  mediaUseVerbFlags,
  resolveMediaUseEnginePath,
} from "./media-use.js";

function tempCommandDir(): string {
  return mkdtempSync(join(tmpdir(), "hyperframes-media-use-command-"));
}

describe("mediaUseEngineEnv", () => {
  it("hands the running CLI entry to the engine", () => {
    const env = mediaUseEngineEnv({ HOME: "/home/u" }, "dist/cli.js", "linux");
    expect(env).toEqual({ HOME: "/home/u", HYPERFRAMES_CLI_ENTRY: resolve("dist/cli.js") });
  });

  it("hands nothing over from a TypeScript source entry, which plain node cannot run", () => {
    expect(mediaUseEngineEnv({}, "src/cli.ts", "linux")).toEqual({});
    expect(mediaUseEngineEnv({}, "", "linux")).toEqual({});
  });

  it.skipIf(process.platform === "win32")(
    "gives the engine no PATH folder in the project, so a tool it runs by name is never the project's",
    () => {
      const project = realpathSync(mkdtempSync(join(tmpdir(), "hf-media-use-project-")));
      onTestFinished(() => rmSync(project, { recursive: true, force: true }));
      const bin = join(project, "node_modules", ".bin");
      mkdirSync(bin, { recursive: true });
      const marker = join(project, "ran");
      writeFileSync(join(bin, "codex"), `#!/bin/sh\necho codex > "${marker}"\n`, { mode: 0o755 });
      vi.spyOn(process, "cwd").mockReturnValue(project);
      onTestFinished(() => {
        vi.restoreAllMocks();
      });

      const env = mediaUseEngineEnv({ PATH: [bin, ".", "/usr/bin", "/bin"].join(delimiter) }, "");
      spawnSync("/bin/sh", ["-c", "codex --version"], { cwd: project, env, stdio: "ignore" });

      expect(existsSync(marker)).toBe(false);
      expect(env.PATH).toBe(["/usr/bin", "/bin"].join(delimiter));
    },
  );
});

describe("mediaUseEngineEnv on Windows", () => {
  function asWindows(): void {
    const realPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    onTestFinished(() => {
      Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
    });
  }

  it("turns off the working-directory program lookup for the engine and its children", () => {
    asWindows();
    const caller: NodeJS.ProcessEnv = { Path: "" };

    const env = mediaUseEngineEnv(caller, "");

    expect(env.NoDefaultCurrentDirectoryInExePath).toBe("1");
    expect(caller).toEqual({ Path: "" });
  });

  it("keeps a value the person set", () => {
    asWindows();

    const env = mediaUseEngineEnv({ NoDefaultCurrentDirectoryInExePath: "yes" }, "");

    expect(env.NoDefaultCurrentDirectoryInExePath).toBe("yes");
  });
});

describe("mediaUseEngineEnv with no trusted PATH folder", () => {
  it("never hands the engine an empty PATH, which would mean the working directory", () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), "hf-media-use-project-")));
    onTestFinished(() => rmSync(project, { recursive: true, force: true }));
    vi.spyOn(process, "cwd").mockReturnValue(project);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });

    const env = mediaUseEngineEnv({ PATH: ["", ".", "bin", project].join(delimiter) }, "", "linux");

    expect(env.PATH).toBeTruthy();
    expect(env.PATH?.split(delimiter)).toHaveLength(1);
    expect(isAbsolute(env.PATH ?? "")).toBe(true);
    expect(existsSync(env.PATH ?? "")).toBe(false);
    expect(env.PATH?.startsWith(project)).toBe(false);
  });
});

describe("media-use command wiring", () => {
  it("uses the bundled engine when the first candidate exists", () => {
    const here = tempCommandDir();
    const engine = join(here, "..", "media-use", "resolve.mjs");
    try {
      expect(resolveMediaUseEnginePath(here, (candidate) => candidate === engine)).toBe(engine);
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });

  it("falls back to the source-tree skill engine", () => {
    const here = tempCommandDir();
    const engine = join(here, "skills", "media-use", "scripts", "resolve.mjs");
    try {
      expect(resolveMediaUseEnginePath(here, (candidate) => candidate === engine)).toBe(engine);
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });

  it("explains how to recover when the engine is absent", () => {
    const here = tempCommandDir();
    try {
      expect(() => resolveMediaUseEnginePath(here)).toThrow(
        "media-use engine is missing from this CLI build; reinstall the CLI or run from a source checkout",
      );
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });

  it("passes flags after the media-use verb through unchanged", () => {
    expect(
      mediaUsePassthroughArgs([
        "/usr/bin/node",
        "cli.js",
        "media-use",
        "resolve",
        "--type",
        "sfx",
        "--intent",
        "cat",
      ]),
    ).toEqual(["--type", "sfx", "--intent", "cat"]);
  });

  it("maps every verb to the engine flag, leaving resolve unflagged", () => {
    for (const verb of MEDIA_USE_VERBS) {
      expect(mediaUseVerbFlags(verb)).toEqual(verb === "resolve" ? [] : [`--${verb}`]);
    }
  });

  it("wires every subcommand to invoke its matching verb", () => {
    const invoked: string[] = [];
    const command = createMediaUseCommand((verb) => {
      invoked.push(verb);
      throw new Error("stop after dispatch");
    });

    for (const verb of MEDIA_USE_VERBS) {
      const factory = (command.subCommands as Record<string, unknown> | undefined)?.[verb];
      expect(factory).toBeTypeOf("function");
      const child = (factory as () => { run?: () => never })();
      expect(() => child.run?.()).toThrow("stop after dispatch");
    }

    expect(invoked).toEqual(MEDIA_USE_VERBS);
  });
});
