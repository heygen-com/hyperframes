import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMediaUseCommand,
  MEDIA_USE_VERBS,
  mediaUsePassthroughArgs,
  mediaUseVerbFlags,
  resolveMediaUseEnginePath,
} from "./media-use.js";

function tempCommandDir(): string {
  return mkdtempSync(join(tmpdir(), "hyperframes-media-use-command-"));
}

describe("media-use command wiring", () => {
  it("uses the bundled engine when the first candidate exists", () => {
    const here = tempCommandDir();
    const engine = join(here, "..", "media-use", "resolve.mjs");
    try {
      expect(resolveMediaUseEnginePath(here, (candidate) => candidate === engine)).toBe(engine);
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });

  it("falls back to the source-tree skill engine", () => {
    const here = tempCommandDir();
    const engine = join(here, "skills", "media-use", "scripts", "resolve.mjs");
    try {
      expect(resolveMediaUseEnginePath(here, (candidate) => candidate === engine)).toBe(engine);
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });

  it("explains how to recover when the engine is absent", () => {
    const here = tempCommandDir();
    try {
      expect(() => resolveMediaUseEnginePath(here)).toThrow(
        "media-use engine is missing from this CLI build; reinstall the CLI or run from a source checkout",
      );
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });

  it("passes flags after the media-use verb through unchanged", () => {
    expect(
      mediaUsePassthroughArgs([
        "/usr/bin/node",
        "cli.js",
        "media-use",
        "resolve",
        "--type",
        "sfx",
        "--intent",
        "cat",
      ]),
    ).toEqual(["--type", "sfx", "--intent", "cat"]);
  });

  it("maps every verb to the engine flag, leaving resolve unflagged", () => {
    for (const verb of MEDIA_USE_VERBS) {
      expect(mediaUseVerbFlags(verb)).toEqual(verb === "resolve" ? [] : [`--${verb}`]);
    }
  });

  it("wires every subcommand to invoke its matching verb", () => {
    const invoked: string[] = [];
    const command = createMediaUseCommand((verb) => {
      invoked.push(verb);
      throw new Error("stop after dispatch");
    });

    for (const verb of MEDIA_USE_VERBS) {
      const factory = (command.subCommands as Record<string, unknown> | undefined)?.[verb];
      expect(factory).toBeTypeOf("function");
      const child = (factory as () => { run?: () => never })();
      expect(() => child.run?.()).toThrow("stop after dispatch");
    }

    expect(invoked).toEqual(MEDIA_USE_VERBS);
  });
});
