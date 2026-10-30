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
});
