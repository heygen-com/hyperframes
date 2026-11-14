import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { shellArg } from "./shellArg.js";

const NAMES = [
  "my-video",
  "서울여행",
  "films/a",
  "my first video",
  "it's mine",
  "it's",
  "a&b",
  "$HOME",
  "o'neil $x",
  "서울 여행 브이로그",
];

describe("shellArg", () => {
  it("leaves a plain name alone and quotes one the shell would split or expand", () => {
    expect(NAMES.map((name) => shellArg(name, "darwin"))).toEqual([
      "my-video",
      "서울여행",
      "films/a",
      '"my first video"',
      `"it's mine"`,
      `"it's"`,
      '"a&b"',
      "'$HOME'",
      `'o'\\''neil $x'`,
      '"서울 여행 브이로그"',
    ]);
  });

  it("uses double quotes on Windows, where a backslash path needs none", () => {
    expect(shellArg("films\\a", "win32")).toBe("films\\a");
    expect(shellArg("my first video", "win32")).toBe('"my first video"');
    expect(shellArg("it's mine", "win32")).toBe(`"it's mine"`);
  });

  const root = mkdtempSync(join(tmpdir(), "hf-shell-arg-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it.skipIf(process.platform === "win32")("prints a cd that a POSIX shell runs as written", () => {
    for (const name of NAMES) {
      mkdirSync(join(root, name), { recursive: true });
      const pwd = execFileSync("/bin/sh", ["-c", `cd ${shellArg(name)} && pwd -P`], {
        cwd: root,
        encoding: "utf8",
      });
      expect(pwd.trim()).toBe(realpathSync(join(root, name)));
    }
  });
});
