import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

  // fails without the fix: the project root's node_modules/.bin that npx adds stayed on PATH when
  // the CLI ran from a subfolder, because only folders inside the working directory were dropped.
  it.each(["linux", "darwin", "win32"] as const)(
    "drops the project root's node_modules/.bin when run from a subfolder, on %s",
    (platform) => {
      const { project, outside } = inProject();
      const sub = join(project, "video");
      mkdirSync(join(sub, "node_modules", ".bin"), { recursive: true });
      // The temp folder is home, so a marker in a folder above it cannot move the project root.
      vi.stubEnv("HOME", dirname(project));
      vi.stubEnv("USERPROFILE", dirname(project));
      onTestFinished(() => {
        vi.unstubAllEnvs();
      });
      vi.spyOn(process, "cwd").mockReturnValue(sub);
      const separator = platform === "win32" ? win32.delimiter : delimiter;
      const env: NodeJS.ProcessEnv = {
        PATH: [
          join(sub, "node_modules", ".bin"),
          join(project, "node_modules", ".bin"),
          join(dirname(project), "node_modules", ".bin"),
          outside[0],
        ].join(separator),
      };

      searchOnlyTrustedFolders(env, platform);

      expect(env.PATH).toBe(outside[0]);
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

  it.skipIf(process.platform === "win32")(
    "a helper started by bare name never runs a same-named file from the project folder",
    () => {
      const { project, outside } = inProject();
      const marker = join(outside[1]!, "ran");
      mkdirSync(join(project, "bin"));
      for (const dir of [project, join(project, "bin")]) {
        writeFileSync(join(dir, "hf-planted-helper"), `#!/bin/sh\necho ran > "${marker}"\n`, {
          mode: 0o755,
        });
      }
      const raw: NodeJS.ProcessEnv = { PATH: [".", "", "bin", outside[0]].join(delimiter) };
      const run = (env: NodeJS.ProcessEnv) =>
        spawnSync("hf-planted-helper", [], { cwd: project, env, stdio: "ignore" });

      expect(run(raw).status).toBe(0);
      expect(existsSync(marker)).toBe(true);
      rmSync(marker);

      const env = { ...raw };
      searchOnlyTrustedFolders(env, process.platform);

      expect((run(env).error as NodeJS.ErrnoException | undefined)?.code).toBe("ENOENT");
      expect(existsSync(marker)).toBe(false);
    },
  );

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
