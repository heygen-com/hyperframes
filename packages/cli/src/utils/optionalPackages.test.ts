import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  OPTIONAL_PACKAGES,
  install,
  loadOptionalPackage,
  optionalPackageDir,
  type OptionalPackageDeps,
} from "./optionalPackages.js";

function fakeDeps(overrides: Partial<OptionalPackageDeps> = {}) {
  const installed = new Map<string, unknown>();
  const log = vi.fn();
  const install = vi.fn(async (dir: string) => {
    installed.set(dir, { fake: "module" });
  });
  const deps: OptionalPackageDeps = {
    cacheDir: "/cache",
    loadInstalled: (dir) => installed.get(dir) ?? null,
    install,
    log,
    ...overrides,
  };
  return { deps, install, log, installed };
}

describe("loadOptionalPackage", () => {
  it("installs on first use with one plain line, then loads from the cache without installing again", async () => {
    const { deps, install, log } = fakeDeps();

    const first = await loadOptionalPackage("onnxruntime-node", "background removal", deps);
    const second = await loadOptionalPackage("onnxruntime-node", "background removal", deps);

    expect(first).toBe(second);
    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith(
      optionalPackageDir("onnxruntime-node", "/cache"),
      "onnxruntime-node",
      OPTIONAL_PACKAGES["onnxruntime-node"],
    );
    expect(log.mock.calls).toEqual([["installing onnxruntime-node for background removal, once"]]);
  });

  it("names the manual command when the install fails", async () => {
    const { deps } = fakeDeps({
      install: async () => {
        throw new Error(
          "npm error code ENOTFOUND\nnpm error syscall getaddrinfo\nnpm error at Foo.bar",
        );
      },
    });

    const failure = loadOptionalPackage("@google/genai", "--describe", deps);

    await expect(failure).rejects.toThrow(
      /--describe needs @google\/genai, and installing it failed \(npm error code ENOTFOUND\)\. /,
    );
    await expect(failure).rejects.toThrow(
      `npm install @google/genai@${OPTIONAL_PACKAGES["@google/genai"]} --prefix "${optionalPackageDir("@google/genai", "/cache")}"`,
    );
  });

  it("blames the network only for network failures", async () => {
    const failWith = (msg: string) =>
      loadOptionalPackage(
        "@google/genai",
        "--describe",
        fakeDeps({
          install: async () => {
            throw new Error(msg);
          },
        }).deps,
      );

    await expect(failWith("npm error code ENOTFOUND")).rejects.toThrow(/Check your network/);
    const fsFailure = failWith("npm error code EACCES");
    await expect(fsFailure).rejects.not.toThrow(/network/);
    await expect(fsFailure).rejects.toThrow(/npm install @google\/genai@/);
  });

  it("does not treat an install that leaves nothing loadable as installed", async () => {
    const { deps } = fakeDeps({ install: async () => {} });

    await expect(loadOptionalPackage("onnxruntime-node", "on-device search", deps)).rejects.toThrow(
      /could not be loaded/,
    );
  });

  it("keeps each version in its own directory so a pin bump never reads a stale install", () => {
    expect(optionalPackageDir("@google/genai", "/cache")).toMatch(
      /[\\/]cache[\\/]@google__genai@\d+\.\d+\.\d+$/,
    );
  });
});

describe("install", () => {
  const name = "@google/genai";
  const version = "1.0.0";

  function setup() {
    const cache = mkdtempSync(join(tmpdir(), "hf-optional-"));
    const dir = join(cache, "pkg@1.0.0");
    const stubNpm = async (args: string[]) => {
      await new Promise((r) => setTimeout(r, 50));
      const prefix = args[args.indexOf("--prefix") + 1] as string;
      if (!existsSync(prefix)) throw new Error("ENOENT: staging dir vanished mid-install");
      mkdirSync(join(prefix, "node_modules", name), { recursive: true });
      writeFileSync(join(prefix, "node_modules", name, "package.json"), "{}");
    };
    return { cache, dir, stubNpm };
  }

  it("lets two concurrent first runs both complete", async () => {
    const { cache, dir, stubNpm } = setup();
    try {
      await Promise.all([
        install(dir, name, version, stubNpm),
        install(dir, name, version, stubNpm),
      ]);
      expect(existsSync(join(dir, "node_modules", name, "package.json"))).toBe(true);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("sweeps a staging dir whose pid is dead and keeps one whose pid is alive", async () => {
    const { cache, dir, stubNpm } = setup();
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid as number;
    const dead = `${dir}.tmp-${deadPid}-abcd1234`;
    const alive = `${dir}.tmp-${process.ppid}-abcd1234`;
    mkdirSync(dead, { recursive: true });
    mkdirSync(alive, { recursive: true });
    try {
      await install(dir, name, version, stubNpm);
      expect(existsSync(dead)).toBe(false);
      expect(existsSync(alive)).toBe(true);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
});
