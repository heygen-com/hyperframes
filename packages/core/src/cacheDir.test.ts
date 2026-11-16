import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  foreignWritablePath,
  hyperframesCacheDir,
  namedCacheDir,
  sealCacheInstall,
  trustedCacheRoot,
} from "./cacheDir.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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

  it("names a folder in the cache only when HYPERFRAMES_CACHE_DIR is set", () => {
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", "");
    expect(namedCacheDir("state")).toBeUndefined();
    const elsewhere = join(tmpdir(), "elsewhere-cache");
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", elsewhere);
    expect(namedCacheDir("state")).toBe(join(elsewhere, "state"));
  });
});

describe.skipIf(process.platform === "win32")("foreignWritablePath", () => {
  let root: string;
  let binary: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hf-trust-"));
    mkdirSync(join(root, "chrome", "v1"), { recursive: true, mode: 0o755 });
    binary = join(root, "chrome", "v1", "chrome-headless-shell");
    writeFileSync(binary, "#!/bin/sh\n", { mode: 0o755 });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** Every file the test made now reads as another account's, as it would without root to chown. */
  const asAnotherAccount = () => vi.spyOn(process, "getuid").mockReturnValue(process.getuid!() + 1);

  it("accepts a file that it and every folder up to the cache root are this account's alone", () => {
    expect(foreignWritablePath(binary, root)).toBeUndefined();
  });

  it("names a file or folder another account owns", () => {
    asAnotherAccount();
    expect(foreignWritablePath(binary, root)).toBe(binary);
  });

  it.each([
    ["group", 0o775],
    ["world", 0o777],
  ])("names the first folder up to the cache root that is %s-writable", (_who, mode) => {
    chmodSync(join(root, "chrome"), mode);
    expect(foreignWritablePath(binary, root)).toBe(join(root, "chrome"));
    chmodSync(join(root, "chrome"), 0o755);
    chmodSync(root, mode);
    expect(foreignWritablePath(binary, root)).toBe(root);
  });

  it("accepts a sticky folder, like /tmp, where others cannot replace this account's entries", () => {
    chmodSync(root, 0o1777);
    expect(foreignWritablePath(binary, root)).toBeUndefined();
    chmodSync(join(root, "chrome"), 0o1777);
    asAnotherAccount();
    expect(foreignWritablePath(join(root, "chrome"), root)).toBe(join(root, "chrome"));
  });

  it("checks the nearest folder above a cache root that does not exist yet", () => {
    chmodSync(root, 0o777);
    expect(foreignWritablePath(join(root, "cache", "x"), join(root, "cache"))).toBe(root);
  });

  it("is skipped on Windows, which has no uid", () => {
    const getuid = process.getuid;
    process.getuid = undefined;
    try {
      chmodSync(binary, 0o777);
      expect(foreignWritablePath(binary, root)).toBeUndefined();
    } finally {
      process.getuid = getuid;
    }
  });

  it("accepts on the next check what this account installed under umask 002, once sealed", () => {
    const previous = process.umask(0o002);
    let installed: string;
    try {
      installed = join(root, "optional", "pkg@1", "node_modules", "pkg");
      mkdirSync(installed, { recursive: true });
      writeFileSync(join(installed, "index.js"), "1");
    } finally {
      process.umask(previous);
    }
    const entry = join(installed, "index.js");
    expect(foreignWritablePath(entry, root)).toBe(entry);
    sealCacheInstall(join(root, "optional", "pkg@1"), root);
    expect(foreignWritablePath(entry, root)).toBeUndefined();
  });

  it("keeps code out of a HYPERFRAMES_CACHE_DIR another account can write, in this user's own cache", () => {
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", root);
    expect(trustedCacheRoot()).toBe(root);
    chmodSync(root, 0o777);
    expect(trustedCacheRoot()).toBe(join(homedir(), ".cache", "hyperframes"));
  });
});

/** Source files under every package's src, tests and test helpers left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(m?[jt]sx?)$/.test(entry.name))
    .filter((entry) => !/\.test[.-]|__tests__/.test(join(entry.parentPath, entry.name)))
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
