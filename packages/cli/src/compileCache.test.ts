import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { enablePrivateCompileCache } from "./compileCache.js";

const roots: string[] = [];
const named = process.env["HYPERFRAMES_CACHE_DIR"];
afterEach(() => {
  if (named === undefined) delete process.env["HYPERFRAMES_CACHE_DIR"];
  else process.env["HYPERFRAMES_CACHE_DIR"] = named;
  for (const root of roots.splice(0)) {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

function cacheRootIn(parentMode: number): string {
  const root = mkdtempSync(join(tmpdir(), "hf-compile-cache-"));
  roots.push(root);
  const parent = join(root, "parent");
  mkdirSync(parent);
  chmodSync(parent, parentMode);
  const cacheRoot = join(parent, "hyperframes");
  process.env["HYPERFRAMES_CACHE_DIR"] = cacheRoot;
  return cacheRoot;
}

function enableWith(env: NodeJS.ProcessEnv = {}) {
  const dirs: string[] = [];
  const dir = enablePrivateCompileCache((at) => dirs.push(at), env);
  return { dir, dirs };
}

describe.skipIf(process.platform === "win32")("enablePrivateCompileCache", () => {
  it("turns the cache on in an owner-only folder inside HyperFrames' cache", () => {
    const cacheRoot = cacheRootIn(0o700);
    const { dir, dirs } = enableWith();
    expect(dir).toBe(join(cacheRoot, "node-compile-cache"));
    expect(dirs).toEqual([dir]);
    const stat = statSync(join(cacheRoot, "node-compile-cache"));
    expect(stat.uid).toBe(process.getuid?.());
    expect(stat.mode & 0o077).toBe(0);
  });

  it("leaves the cache off when another account can write a folder above it", () => {
    cacheRootIn(0o777);
    expect(enableWith()).toEqual({ dir: undefined, dirs: [] });
  });

  it("leaves a NODE_COMPILE_CACHE or NODE_DISABLE_COMPILE_CACHE the person set to Node", () => {
    cacheRootIn(0o700);
    expect(enableWith({ NODE_COMPILE_CACHE: "/their/choice" }).dirs).toEqual([]);
    expect(enableWith({ NODE_DISABLE_COMPILE_CACHE: "1" }).dirs).toEqual([]);
  });
});
