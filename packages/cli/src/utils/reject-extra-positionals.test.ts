import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArgsDef, CommandDef } from "citty";
import audio from "../commands/audio.js";
import { CliUsageError } from "./commandResult.js";
import { resolveExtraPositionals } from "./reject-extra-positionals.js";

afterEach(() => vi.restoreAllMocks());

describe("resolveExtraPositionals", () => {
  it("lets audio take several files, which its help promises and its analysis handles", () => {
    const parsed = { _: ["a.wav", "b.wav"], files: "a.wav" };
    expect(() =>
      resolveExtraPositionals(audio as CommandDef<ArgsDef>, "audio", parsed),
    ).not.toThrow();
  });

  it("still rejects an extra argument for a command that reads one", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const single = { args: { file: { type: "positional" } } } as CommandDef<ArgsDef>;
    expect(() => resolveExtraPositionals(single, "single", { _: ["a", "b"], file: "a" })).toThrow(
      CliUsageError,
    );
  });

  it.each([
    ["the positional", (dir: string) => ["measure", "probe", join(dir, "ref"), "one", "take.mp4"]],
    [
      "a flag value",
      (dir: string) => [
        "measure",
        "look",
        join(dir, "a.mp4"),
        "--compare",
        join(dir, "ref"),
        "one",
        "take.mp4",
      ],
    ],
    [
      "a flag=value",
      (dir: string) => [
        "measure",
        "look",
        join(dir, "a.mp4"),
        `--compare=${join(dir, "ref")}`,
        "one",
        "take.mp4",
      ],
    ],
  ])("says to quote a path the shell split at its spaces in %s", (_label, argvOf) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-extra-"));
    mkdirSync(join(dir, "ref one"));
    writeFileSync(join(dir, "ref one take.mp4"), "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const argv = process.argv;
    process.argv = ["node", "hyperframes", ...argvOf(dir)];
    const single = { args: { video: { type: "positional" } } } as CommandDef<ArgsDef>;
    try {
      expect(() =>
        resolveExtraPositionals(single, "measure", { _: ["x", "take.mp4"], video: "x" }),
      ).toThrow(CliUsageError);
      expect(error.mock.calls[0]![0]).toContain(
        `'${join(dir, "ref")} one take.mp4' is one path with spaces: quote it.`,
      );
    } finally {
      process.argv = argv;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
