import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  OPTIONAL_PACKAGES,
  install,
  installedOptionalPackageVersion,
  loadBesideCli,
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
    loadBesideCli: () => null,
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

  it("uses the pinned copy installed beside the CLI, without installing", async () => {
    const beside = { beside: "module" };
    const { deps, install, log } = fakeDeps({ loadBesideCli: () => beside });

    expect(await loadOptionalPackage("onnxruntime-node", "on-device search", deps)).toBe(beside);
    expect(install).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
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

describe("a copy installed beside the CLI", () => {
  // node_modules/hyperframes/dist/cli.js with onnxruntime-node installed next to hyperframes.
  function layout(version: string) {
    const root = mkdtempSync(join(tmpdir(), "hf-beside-"));
    const pkg = join(root, "node_modules", "onnxruntime-node");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ version, main: "index.js" }));
    writeFileSync(join(pkg, "index.js"), `module.exports = { copy: "beside ${version}" };`);
    const cliUrl = pathToFileURL(join(root, "node_modules", "hyperframes", "dist", "cli.js")).href;
    return { root, cliUrl };
  }

  it("loads it and reports its version when it is the pinned version", () => {
    const pin = OPTIONAL_PACKAGES["onnxruntime-node"];
    const { root, cliUrl } = layout(pin);
    try {
      expect(loadBesideCli("onnxruntime-node", cliUrl)).toEqual({ copy: `beside ${pin}` });
      expect(installedOptionalPackageVersion("onnxruntime-node", "/no-cache", cliUrl)).toBe(pin);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores it when its manifest is unreadable, instead of throwing", () => {
    const { root, cliUrl } = layout(OPTIONAL_PACKAGES["onnxruntime-node"]);
    writeFileSync(join(root, "node_modules", "onnxruntime-node", "package.json"), "{ version: 1");
    try {
      expect(loadBesideCli("onnxruntime-node", cliUrl)).toBeNull();
      expect(installedOptionalPackageVersion("onnxruntime-node", "/no-cache", cliUrl)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks the copy require would load first, not a later pinned one", () => {
    const { root, cliUrl } = layout(OPTIONAL_PACKAGES["onnxruntime-node"]);
    const nearer = join(root, "node_modules", "hyperframes", "node_modules", "onnxruntime-node");
    mkdirSync(nearer, { recursive: true });
    writeFileSync(join(nearer, "index.js"), `module.exports = { copy: "unversioned" };`);
    try {
      expect(loadBesideCli("onnxruntime-node", cliUrl)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads a symlinked copy, as bun and pnpm lay packages out", () => {
    const pin = OPTIONAL_PACKAGES["onnxruntime-node"];
    const { root, cliUrl } = layout(pin);
    const linked = join(root, "node_modules", "onnxruntime-node");
    const store = join(root, "store", "onnxruntime-node");
    mkdirSync(join(root, "store"), { recursive: true });
    renameSync(linked, store);
    symlinkSync(store, linked, "dir");
    try {
      expect(loadBesideCli("onnxruntime-node", cliUrl)).toEqual({ copy: `beside ${pin}` });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("looks past an empty folder that require skips", () => {
    const pin = OPTIONAL_PACKAGES["onnxruntime-node"];
    const { root, cliUrl } = layout(pin);
    mkdirSync(join(root, "node_modules", "hyperframes", "node_modules", "onnxruntime-node"), {
      recursive: true,
    });
    try {
      expect(loadBesideCli("onnxruntime-node", cliUrl)).toEqual({ copy: `beside ${pin}` });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores a file require would load before the pinned folder", () => {
    const { root, cliUrl } = layout(OPTIONAL_PACKAGES["onnxruntime-node"]);
    const nearer = join(root, "node_modules", "hyperframes", "node_modules");
    mkdirSync(nearer, { recursive: true });
    writeFileSync(join(nearer, "onnxruntime-node.js"), `module.exports = { copy: "file" };`);
    try {
      expect(loadBesideCli("onnxruntime-node", cliUrl)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores it at any other version, so the cache install is used", () => {
    const { root, cliUrl } = layout("1.0.0");
    try {
      expect(loadBesideCli("onnxruntime-node", cliUrl)).toBeNull();
      expect(installedOptionalPackageVersion("onnxruntime-node", "/no-cache", cliUrl)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  it("gives each overlapping install in one process its own staging dir", async () => {
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

  it("leaves another live process's in-progress staging dir alone while it installs", async () => {
    const { cache, dir, stubNpm } = setup();
    const foreign = `${dir}.tmp-${process.ppid}-abcd1234`;
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "partial"), "downloading");
    try {
      await install(dir, name, version, stubNpm);
      expect(existsSync(join(foreign, "partial"))).toBe(true);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("sweeps a staging dir whose pid is dead and keeps one whose pid is alive", async () => {
    const { cache, dir, stubNpm } = setup();
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid as number;
    const dead = `${dir}.tmp-${deadPid}-abcd1234`;
    const deadOldFormat = `${dir}.tmp-${deadPid}`;
    const alive = `${dir}.tmp-${process.ppid}-abcd1234`;
    mkdirSync(dead, { recursive: true });
    mkdirSync(deadOldFormat, { recursive: true });
    mkdirSync(alive, { recursive: true });
    try {
      await install(dir, name, version, stubNpm);
      expect(existsSync(dead)).toBe(false);
      expect(existsSync(deadOldFormat)).toBe(false);
      expect(existsSync(alive)).toBe(true);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
});
