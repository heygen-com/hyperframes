import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
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
    expect(shellArg("Q&A (draft); 100%", "win32")).toBe('"Q&A (draft); 100%"');
    expect(shellArg("서울 여행", "win32")).toBe('"서울 여행"');
  });

  it("quotes a Windows name that PowerShell would read as an array or a splat", () => {
    expect(shellArg("a,b", "win32")).toBe('"a,b"');
    expect(shellArg("@scope", "win32")).toBe('"@scope"');
    expect(shellArg("films\\@scope", "win32")).toBe("films\\@scope");
  });

  it("single-quotes a Windows name that PowerShell or Git Bash would expand in double quotes", () => {
    expect(shellArg("$(calc)", "win32")).toBe("'$(calc)'");
    expect(shellArg("a`b", "win32")).toBe("'a`b'");
    expect(shellArg("o'neil $x", "win32")).toBe("'o''neil $x'");
    expect(shellArg("x\u201D;calc;\u201Dy", "win32")).toBe("'x\u201D;calc;\u201Dy'");
    expect(shellArg("x\u2019;calc;\u2018 $y", "win32")).toBe(
      "'x\u2019\u2019;calc;\u2018\u2018 $y'",
    );
  });

  it("prints nothing on Windows for a name no shell there reads literally", () => {
    expect(shellArg("$(calc)&calc", "win32")).toBeNull();
    expect(shellArg("a`b|c", "win32")).toBeNull();
    expect(shellArg("a\nb", "win32")).toBeNull();
  });

  const root = mkdtempSync(join(tmpdir(), "hf-shell-arg-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it.skipIf(process.platform === "win32")("prints a cd that a POSIX shell runs as written", () => {
    for (const name of NAMES) {
      mkdirSync(join(root, name), { recursive: true });
      const pwd = execFileSync("/bin/sh", ["-c", `cd ${shellArg(name, "darwin")} && pwd -P`], {
        cwd: root,
        encoding: "utf8",
      });
      expect(pwd.trim()).toBe(realpathSync(join(root, name)));
    }
  });

  it.skipIf(process.platform === "win32")(
    "prints a Windows word that Git Bash expands no part of",
    () => {
      const hostile = ["$(touch ran)", "`touch ran`", "a $(touch ran) b", "o'neil $(touch ran)"];
      for (const name of hostile) {
        const word = shellArg(name, "win32");
        expect(word).not.toBeNull();
        execFileSync("/bin/bash", ["-c", `printf %s ${word} > /dev/null`], { cwd: root });
        expect(existsSync(join(root, "ran"))).toBe(false);
      }
    },
  );
});
