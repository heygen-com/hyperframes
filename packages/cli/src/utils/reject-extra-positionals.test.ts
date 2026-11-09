import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("says to quote a path the shell split at its spaces", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-extra-"));
    writeFileSync(join(dir, "ref one.mp4"), "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const single = { args: { video: { type: "positional" } } } as CommandDef<ArgsDef>;
    const head = join(dir, "ref");
    try {
      expect(() =>
        resolveExtraPositionals(single, "measure probe", { _: [head, "one.mp4"], video: head }),
      ).toThrow(CliUsageError);
      expect(error.mock.calls[0]![0]).toContain(
        `'${join(dir, "ref one.mp4")}' is one path with spaces: quote it.`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
