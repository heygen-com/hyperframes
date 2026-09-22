import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCaptureFileSync } from "./captureFile.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function scratch(): { outputDir: string; victim: string } {
  const root = mkdtempSync(join(tmpdir(), "hyperframes-capture-file-"));
  temporaryDirectories.push(root);
  const outputDir = join(root, "capture");
  mkdirSync(outputDir);
  const victim = join(root, "victim.txt");
  writeFileSync(victim, "do not touch");
  return { outputDir, victim };
}

// Creating symlinks needs elevated rights on Windows, and POSIX modes don't apply there.
const posixOnly = it.skipIf(process.platform === "win32");

describe("writeCaptureFileSync", () => {
  posixOnly("replaces a pre-planted symlink instead of writing through it", () => {
    const { outputDir, victim } = scratch();
    const target = join(outputDir, "page.html");
    symlinkSync(victim, target);

    writeCaptureFileSync(target, "<html></html>", "utf-8");

    expect(readFileSync(victim, "utf8")).toBe("do not touch");
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("<html></html>");
  });

  it("replaces a pre-planted hard link instead of truncating the shared file", () => {
    const { outputDir, victim } = scratch();
    const target = join(outputDir, "tokens.json");
    linkSync(victim, target);

    writeCaptureFileSync(target, "{}");

    expect(readFileSync(victim, "utf8")).toBe("do not touch");
    expect(readFileSync(target, "utf8")).toBe("{}");
  });

  it("still overwrites a capture file written earlier in the run", () => {
    const { outputDir } = scratch();
    const target = join(outputDir, "page.html");
    writeCaptureFileSync(target, "first attempt");

    writeCaptureFileSync(target, "partial bundle");

    expect(readFileSync(target, "utf8")).toBe("partial bundle");
  });

  posixOnly("creates the file readable by the owner only", () => {
    const { outputDir } = scratch();
    const target = join(outputDir, "meta.json");

    writeCaptureFileSync(target, "{}");

    expect(lstatSync(target).mode & 0o777).toBe(0o600);
  });

  it("keeps a caller's exclusive-create flag", () => {
    const { outputDir } = scratch();
    const target = join(outputDir, "meta.json");
    writeCaptureFileSync(target, "real meta");

    expect(() => writeCaptureFileSync(target, "partial meta", { flag: "wx" })).toThrow(
      expect.objectContaining({ code: "EEXIST" }),
    );
    expect(readFileSync(target, "utf8")).toBe("real meta");
  });

  posixOnly("refuses a pre-planted symlink under a caller's exclusive-create flag", () => {
    const { outputDir, victim } = scratch();
    const target = join(outputDir, "meta.json");
    symlinkSync(victim, target);

    expect(() => writeCaptureFileSync(target, "partial meta", { flag: "wx" })).toThrow(
      expect.objectContaining({ code: "EEXIST" }),
    );
    expect(readFileSync(victim, "utf8")).toBe("do not touch");
  });

  it("cleans up only what it created, even when the final rename fails", () => {
    const { outputDir } = scratch();
    const neighbour = join(outputDir, ".capture-keep");
    writeFileSync(neighbour, "someone else's file");
    mkdirSync(join(outputDir, "occupied"));

    writeCaptureFileSync(join(outputDir, "a.txt"), "a");
    expect(() => writeCaptureFileSync(join(outputDir, "occupied"), "b")).toThrow();

    expect(readFileSync(neighbour, "utf8")).toBe("someone else's file");
    expect(readdirSync(outputDir).sort()).toEqual([".capture-keep", "a.txt", "occupied"]);
  });

  it("leaves no temporary file behind, even when the final rename fails", () => {
    const { outputDir } = scratch();
    writeCaptureFileSync(join(outputDir, "a.txt"), "a");
    mkdirSync(join(outputDir, "occupied"));

    expect(() => writeCaptureFileSync(join(outputDir, "occupied"), "b")).toThrow();

    expect(readdirSync(outputDir).sort()).toEqual(["a.txt", "occupied"]);
  });
});
