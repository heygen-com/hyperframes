import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
  chmodSync,
  linkSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { publishRegistryFile, registryRoot, registryTargetPath } from "./publication.js";

it("rejects traversal, Windows aliases and streams before publication", () => {
  const root = registryRoot(mkdtempSync(join(tmpdir(), "hf-publish-")));
  try {
    for (const target of [
      "../outside",
      "/absolute",
      "C:alias",
      "file:stream",
      "CON.txt",
      "nul",
      "folder/LPT1.txt",
      "trailing.",
      "trailing ",
      "a//b",
      "a/./b",
    ]) {
      expect(() => registryTargetPath(root, target), target).toThrow(/Unsafe target/);
    }
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("protects external leaf symlinks including the install record", () => {
  const root = registryRoot(mkdtempSync(join(tmpdir(), "hf-publish-")));
  const outside = mkdtempSync(join(tmpdir(), "hf-outside-"));
  try {
    const victim = join(outside, "victim.json");
    writeFileSync(victim, "original");
    for (const target of ["file.html", "hyperframes.lock.json"]) {
      symlinkSync(victim, join(root, target), "file");
      expect(() => publishRegistryFile(root, target, "attack")).toThrow(/Unsafe target/);
      expect(readFileSync(victim, "utf8")).toBe("original");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
it("atomically replaces a hard-linked leaf without altering its other name", () => {
  const root = registryRoot(mkdtempSync(join(tmpdir(), "hf-publish-")));
  try {
    writeFileSync(join(root, "original"), "old");
    linkSync(join(root, "original"), join(root, "target"));
    publishRegistryFile(root, "target", "new");
    expect(readFileSync(join(root, "original"), "utf8")).toBe("old");
    expect(readFileSync(join(root, "target"), "utf8")).toBe("new");
    mkdirSync(join(root, "directory"));
    expect(() => publishRegistryFile(root, "directory", "cannot replace directory")).toThrow();
    expect(readdirSync(root).some((name) => name.startsWith(".hf-install-"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("publishes through an internal leaf alias to its physical target", () => {
  const root = registryRoot(mkdtempSync(join(tmpdir(), "hf-publish-")));
  try {
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested/physical"), "old");
    symlinkSync(join(root, "nested/physical"), join(root, "alias"), "file");
    publishRegistryFile(root, "alias", "new");
    expect(lstatSync(join(root, "alias")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(root, "nested/physical"), "utf8")).toBe("new");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "preserves executable mode when replacing an installed file",
  () => {
    const root = registryRoot(mkdtempSync(join(tmpdir(), "hf-mode-")));
    try {
      const path = join(root, "script.sh");
      writeFileSync(path, "old");
      chmodSync(path, 0o755);
      publishRegistryFile(root, "script.sh", "new");
      expect(lstatSync(path).mode & 0o777).toBe(0o755);
      symlinkSync(path, join(root, "alias"), "file");
      publishRegistryFile(root, "alias", "via alias");
      expect(lstatSync(path).mode & 0o777).toBe(0o755);
      expect(lstatSync(join(root, "alias")).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
