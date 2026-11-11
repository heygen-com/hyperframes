import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { wallSetTimeout } from "./wallClock";

const runtimeDir = __dirname;
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__fixtures__" ? [] : sources(path);
    return /\.ts$/.test(name) && !/\.(test|d)\.ts$/.test(name) ? [path] : [];
  });

describe("wall clock timers", () => {
  afterEach(() => {
    delete (window as { __HF_VIRTUAL_TIME__?: unknown }).__HF_VIRTUAL_TIME__;
  });

  it("use the render shim's original timers while page timers wait for the next seek", async () => {
    const realSetTimeout = globalThis.setTimeout;
    (window as { __HF_VIRTUAL_TIME__?: unknown }).__HF_VIRTUAL_TIME__ = {
      originalSetTimeout: realSetTimeout,
    };
    globalThis.setTimeout = ((): number => 0) as unknown as typeof setTimeout;
    try {
      await expect(
        new Promise((resolve) => wallSetTimeout(() => resolve("fired"), 5)),
      ).resolves.toBe("fired");
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it("are the only timers the runtime calls", () => {
    const call = /(?<![\w$.])(?:window\.)?(?:set|clear)(?:Timeout|Interval)\(/;
    const offenders = sources(runtimeDir)
      .filter((path) => !path.endsWith("wallClock.ts"))
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split("\n")
          .map((line, i) => ({ line, at: `${path.slice(runtimeDir.length + 1)}:${i + 1}` }))
          .filter(({ line }) => call.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line))
          .map(({ at }) => at),
      );
    expect(offenders).toEqual([]);
  });
});
