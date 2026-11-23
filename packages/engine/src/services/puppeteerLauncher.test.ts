import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// @puppeteer/browsers before 3.2.2 started Chrome detached on every platform. On Windows a detached Chrome has no
// console, so Windows Terminal opens a window for each Chrome process of a render.
const FIRST_SAFE = [3, 2, 2];

function launcherVersion(): number[] {
  const fromEngine = createRequire(new URL("../../package.json", import.meta.url));
  const fromPuppeteer = createRequire(fromEngine.resolve("puppeteer/package.json"));
  const fromCore = createRequire(fromPuppeteer.resolve("puppeteer-core/package.json"));
  return (fromCore("@puppeteer/browsers/package.json") as { version: string }).version
    .split(".")
    .map(Number);
}

describe("the Puppeteer the engine launches Chrome with", () => {
  it("does not start Chrome detached on Windows", () => {
    const version = launcherVersion();
    const behind = FIRST_SAFE.findIndex((part, i) => version[i] !== part);
    const atLeast = behind === -1 || (version[behind] ?? 0) > (FIRST_SAFE[behind] ?? 0);
    expect(atLeast, `@puppeteer/browsers ${version.join(".")}`).toBe(true);
  });
});
