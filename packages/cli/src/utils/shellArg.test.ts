import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { shellArg } from "./shellArg.js";

const WINDOWS_ROUND_TRIP = [
  "my-video",
  "my first video",
  "it's mine",
  "o\u2019neil \u2018draft\u2019 it's",
  "\u201Alow\u201B 'n\u2019 \u2018mixed'",
  "Q&A (draft); 100% | a<b>c ^",
  "100% done",
  "서울 여행",
  "a,b",
  "@scope",
  "films\\my film",
  "C:\\Users\\Bob\\film",
  "C:\\work\\it's\\",
];

// `“ ” „` end a PowerShell double-quoted string; `$` and a backtick expand in PowerShell and Git Bash,
// `!` in interactive Git Bash, and `%NAME%` in cmd.exe.
const WINDOWS_UNPRINTABLE = [
  "$(calc)",
  "a`b",
  "o'neil $x",
  "x\u201D;calc;\u201Dy",
  "x\u2019;calc;\u2018 $y",
  "$(calc)&calc",
  "\u201Cquoted\u201D",
  "a\nb",
  "%USERPROFILE%",
  "50% off, 20% more",
  "Hello!",
  "a!b",
];

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

  it("uses double quotes on Windows, for a backslash path too", () => {
    expect(shellArg("films/a", "win32")).toBe("films/a");
    expect(shellArg("films\\a", "win32")).toBe('"films\\a"');
    expect(shellArg("C:\\Users\\Bob\\film", "win32")).toBe('"C:\\Users\\Bob\\film"');
    expect(shellArg("C:\\", "win32")).toBe('"C:\\\\"');
    expect(shellArg("my first video", "win32")).toBe('"my first video"');
    expect(shellArg("it's mine", "win32")).toBe(`"it's mine"`);
    expect(shellArg("Q&A (draft); 100%", "win32")).toBe('"Q&A (draft); 100%"');
    expect(shellArg("서울 여행", "win32")).toBe('"서울 여행"');
  });

  it("quotes a Windows name that PowerShell would read as an array or a splat", () => {
    expect(shellArg("a,b", "win32")).toBe('"a,b"');
    expect(shellArg("@scope", "win32")).toBe('"@scope"');
    expect(shellArg("films/@scope", "win32")).toBe("films/@scope");
  });

  it("prints nothing on Windows for a name no shell there reads literally", () => {
    for (const name of WINDOWS_UNPRINTABLE) expect(shellArg(name, "win32"), name).toBeNull();
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
    "prints a Windows word that Git Bash reads as written",
    () => {
      for (const name of WINDOWS_ROUND_TRIP) {
        const shown = execFileSync("/bin/bash", ["-c", `printf %s ${shellArg(name, "win32")}`], {
          encoding: "utf8",
        });
        expect(shown, name).toBe(name);
      }
    },
  );

  const argvScript = join(root, "argv.cjs");
  writeFileSync(argvScript, "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
  const readArgv = (output: string): string[] => JSON.parse(output) as string[];

  it.runIf(process.platform === "win32")(
    "prints a Windows word that cmd.exe reads as written",
    () => {
      for (const name of WINDOWS_ROUND_TRIP) {
        const line = `"${process.execPath}" "${argvScript}" ${shellArg(name, "win32")}`;
        const run = spawnSync("cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
          encoding: "utf8",
          windowsVerbatimArguments: true,
        });
        expect(run.status, run.stderr).toBe(0);
        expect(readArgv(run.stdout), name).toEqual([name]);
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "prints a Windows word that PowerShell reads as written",
    () => {
      for (const name of WINDOWS_ROUND_TRIP) {
        const line = `& '${process.execPath}' '${argvScript}' ${shellArg(name, "win32")}`;
        const output = execFileSync(
          "powershell.exe",
          ["-NoProfile", "-EncodedCommand", Buffer.from(line, "utf16le").toString("base64")],
          { encoding: "utf8" },
        );
        // Windows PowerShell hands a space-free word to a program unquoted, so a doubled trailing backslash stays doubled.
        expect(
          readArgv(output).map((arg) => win32.normalize(arg)),
          name,
        ).toEqual([win32.normalize(name)]);
      }
    },
  );
});
