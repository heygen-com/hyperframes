import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaUsePassthroughArgs, resolveMediaUseEnginePath } from "./media-use.js";

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
});
