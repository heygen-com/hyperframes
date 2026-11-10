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
