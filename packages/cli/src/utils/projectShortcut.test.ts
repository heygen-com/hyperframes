import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commandWordIndex, openShortcutArgv } from "./projectShortcut.js";

const commands = new Set(["open", "render", "lint"]);
const cwd = mkdtempSync(join(tmpdir(), "hf-shortcut-"));
mkdirSync(join(cwd, "my-video"));
mkdirSync(join(cwd, "render"));
writeFileSync(join(cwd, "notes.txt"), "");
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

describe("openShortcutArgv", () => {
  it.each([".", "./my-video", "my-video", cwd])("opens the folder %s", (dir) => {
    expect(openShortcutArgv([dir], commands, cwd)).toEqual(["open", dir]);
  });

  it("keeps the flags that follow the folder", () => {
    expect(openShortcutArgv(["my-video", "--json"], commands, cwd)).toEqual([
      "open",
      "my-video",
      "--json",
    ]);
  });

  it("finds the folder after root flags, like the command word", () => {
    expect(openShortcutArgv(["--verbose", "my-video", "--json"], commands, cwd)).toEqual([
      "--verbose",
      "open",
      "my-video",
      "--json",
    ]);
  });

  it("ignores a folder after the -- separator", () => {
    expect(openShortcutArgv(["--", "my-video"], commands, cwd)).toEqual(["--", "my-video"]);
  });

  it("lets a known command win over a folder with its name", () => {
    expect(openShortcutArgv(["render"], commands, cwd)).toEqual(["render"]);
  });

  it.each([[[]], [["--help"]], [["notes.txt"]], [["nope"]]])("leaves %j alone", (argv) => {
    expect(openShortcutArgv(argv, commands, cwd)).toEqual(argv);
  });
});

describe("commandWordIndex", () => {
  it.each([
    [["render", "x"], 0],
    [["--verbose", "render"], 1],
    [["--verbose"], -1],
    [["--", "render"], -1],
    [["--verbose", "--", "render"], -1],
    [[], -1],
  ] as const)("%j -> %i", (argv, index) => {
    expect(commandWordIndex(argv)).toBe(index);
  });
});
