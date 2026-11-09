import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commandWordIndex, measureProbeShortcutArgv, openShortcutArgv } from "./projectShortcut.js";

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

describe("measureProbeShortcutArgv", () => {
  const ops = new Set(["probe", "cuts", "events"]);
  writeFileSync(join(cwd, "ref.mp4"), "");
  writeFileSync(join(cwd, "ref one.mp4"), "");

  it.each([
    [
      ["measure", "ref.mp4"],
      ["measure", "probe", "ref.mp4"],
    ],
    [
      ["measure", "ref.mp4", "--json"],
      ["measure", "probe", "ref.mp4", "--json"],
    ],
    [
      ["--verbose", "measure", "ref.mp4"],
      ["--verbose", "measure", "probe", "ref.mp4"],
    ],
    [
      ["measure", "ref", "one.mp4"],
      ["measure", "probe", "ref one.mp4"],
    ],
    [
      ["measure", "ref", "one.mp4", "--json"],
      ["measure", "probe", "ref one.mp4", "--json"],
    ],
  ])("probes %j", (argv, expected) => {
    expect(measureProbeShortcutArgv(argv, ops, cwd)).toEqual(expected);
  });

  it.each([
    [["measure", "cuts", "ref.mp4"]], // an op was named
    [["measure", "ref.mp4", "--map"]], // other flags: which op is a guess
    [["measure", "missing.mp4"]], // not a file
    [["measure", "my-video"]], // a folder
    [["measure"]],
    [["render", "ref.mp4"]],
  ])("leaves %j alone", (argv) => {
    expect(measureProbeShortcutArgv(argv, ops, cwd)).toEqual(argv);
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
