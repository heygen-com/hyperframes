import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  searchOnlyTrustedFolders,
  skipWorkingDirectoryInExeSearch,
  withOnlyTrustedPathFolders,
} from "./windowsExeSearch.js";

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function inProject(): { project: string; outside: string[] } {
  const project = tempDir("hf-exe-search-project-");
  const outside = [tempDir("hf-exe-search-a-"), tempDir("hf-exe-search-b-")];
  mkdirSync(join(project, "node_modules", ".bin"), { recursive: true });
  vi.spyOn(process, "cwd").mockReturnValue(project);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  return { project, outside };
}

describe("skipWorkingDirectoryInExeSearch", () => {
  it("turns off the working-directory lookup on Windows", () => {
    const env: NodeJS.ProcessEnv = {};
    skipWorkingDirectoryInExeSearch(env, "win32");
    expect(env.NoDefaultCurrentDirectoryInExePath).toBe("1");
  });

  it("keeps a value the user already set", () => {
    const env: NodeJS.ProcessEnv = { NoDefaultCurrentDirectoryInExePath: "yes" };
    skipWorkingDirectoryInExeSearch(env, "win32");
    expect(env.NoDefaultCurrentDirectoryInExePath).toBe("yes");
  });

  it("leaves other platforms alone", () => {
    const env: NodeJS.ProcessEnv = {};
    skipWorkingDirectoryInExeSearch(env, "darwin");
    expect(env).toEqual({});
  });
});

describe("searchOnlyTrustedFolders", () => {
  it.each(["linux", "darwin", "win32"] as const)(
    "keeps only absolute PATH folders outside the project, in order, on %s",
    (platform) => {
      const { project, outside } = inProject();
      const separator = platform === "win32" ? win32.delimiter : delimiter;
      const env: NodeJS.ProcessEnv = {
        PATH: [
          "",
          ".",
          join("node_modules", ".bin"),
          outside[0],
          join(project, "node_modules", ".bin"),
          project,
          outside[1],
        ].join(separator),
      };

      searchOnlyTrustedFolders(env, platform);

      expect(env.PATH).toBe([outside[0], outside[1]].join(separator));
    },
  );

  it("finds the PATH key whatever its case, as Windows spells it Path", () => {
    const { project, outside } = inProject();
    const env: NodeJS.ProcessEnv = { Path: [project, outside[0], "."].join(win32.delimiter) };

    searchOnlyTrustedFolders(env, "win32");

    expect(env).toEqual({ Path: outside[0], NoDefaultCurrentDirectoryInExePath: "1" });
  });

  it("accepts a Windows PATH entry wrapped in double quotes", () => {
    const { project, outside } = inProject();
    const env: NodeJS.ProcessEnv = {
      Path: [`"${outside[0]}"`, `"${project}"`, outside[1]].join(win32.delimiter),
    };

    expect(withOnlyTrustedPathFolders(env, "win32").Path).toBe(
      [outside[0], outside[1]].join(win32.delimiter),
    );
  });

  it("never leaves an empty PATH, which would mean the working directory", () => {
    const { project } = inProject();
    const env: NodeJS.ProcessEnv = { PATH: ["", ".", project].join(delimiter) };

    searchOnlyTrustedFolders(env, "linux");

    expect(env.PATH?.split(delimiter)).toHaveLength(1);
    expect(isAbsolute(env.PATH ?? "")).toBe(true);
    expect(existsSync(env.PATH ?? "")).toBe(false);
    expect(env.PATH?.startsWith(project)).toBe(false);
  });

  it("adds no PATH when there was none", () => {
    inProject();
    const env: NodeJS.ProcessEnv = {};

    searchOnlyTrustedFolders(env, "linux");

    expect(env).toEqual({});
  });
});

describe("program entries", () => {
  it("each one that starts its own process turns the lookup off before it spawns anything", () => {
    const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const tsup = readFileSync(join(cliRoot, "tsup.config.ts"), "utf8");
    const entries = [...tsup.matchAll(/^\s+\w+: "(src\/[^"]+\.ts)",$/gm)].map((m) => m[1]!);
    const programs = entries.filter((entry) =>
      readFileSync(join(cliRoot, entry), "utf8").includes('hideChildConsoles.js";'),
    );
    expect(programs).toContain("src/warmCheck.ts");
    const missing = programs.filter(
      (entry) => !readFileSync(join(cliRoot, entry), "utf8").includes('windowsExeSearch.js";'),
    );
    expect(missing).toEqual([]);
  });
});
