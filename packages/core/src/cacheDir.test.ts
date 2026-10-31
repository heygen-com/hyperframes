import { readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hyperframesCacheDir } from "./cacheDir.js";

afterEach(() => vi.unstubAllEnvs());

describe("hyperframesCacheDir", () => {
  it("defaults to ~/.cache/hyperframes", () => {
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", "");
    expect(hyperframesCacheDir()).toBe(join(homedir(), ".cache", "hyperframes"));
    expect(hyperframesCacheDir("chrome")).toBe(join(homedir(), ".cache", "hyperframes", "chrome"));
  });

  it("follows HYPERFRAMES_CACHE_DIR, read on each call, a relative one resolved", () => {
    const elsewhere = join(tmpdir(), "elsewhere-cache");
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", elsewhere);
    expect(hyperframesCacheDir("whisper", "models")).toBe(join(elsewhere, "whisper", "models"));
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", "rel/cache");
    expect(hyperframesCacheDir("tts")).toBe(join(resolve("rel/cache"), "tts"));
  });
});

/** Source files under every package's src, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(m?[jt]sx?)$/.test(entry.name))
    .filter((entry) => !/\.test\.|__tests__/.test(join(entry.parentPath, entry.name)))
    .map((entry) => join(entry.parentPath, entry.name));
}

it("every cache path in every package goes through hyperframesCacheDir", () => {
  const packages = resolve(__dirname, "..", "..");
  const built: string[] = [];
  for (const name of readdirSync(packages)) {
    let files: string[];
    try {
      files = sources(join(packages, name, "src"));
    } catch {
      continue; // a package without src
    }
    for (const file of files) {
      if (file.endsWith(join("core", "src", "cacheDir.ts"))) continue;
      // Prose about the default path is fine; code that builds it is not.
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      if (
        /["'`]\.cache["'`]\s*,\s*["'`]hyperframes["'`]|["'`][^"'`\n]*\.cache\/hyperframes/.test(
          code,
        )
      )
        built.push(file.slice(packages.length + 1));
    }
  }
  expect(built).toEqual([]);
});
