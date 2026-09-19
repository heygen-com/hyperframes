import { describe, expect, it, vi } from "vitest";
import {
  OPTIONAL_PACKAGES,
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
