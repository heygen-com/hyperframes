import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { skipWorkingDirectoryInExeSearch } from "./windowsExeSearch.js";

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
