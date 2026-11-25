import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assetRootsRefusal, isPrivateUnderAssetRoots } from "./assetRoots.js";

describe("isPrivateUnderAssetRoots", () => {
  const root = mkdtempSync(join(tmpdir(), "hf-asset-roots-"));
  const projectDir = join(root, "project");
  const workDir = join(projectDir, ".hyperframes", "share-renders", "work");
  const roots = [projectDir, join(workDir, "compiled"), join(workDir, "downloads")];
  const file = (rel: string) => {
    const path = join(projectDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "x");
    return path;
  };
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    ".git/objects/clip.mp4",
    ".hyperframes/agent-handoff.mp4",
    ".claude/voice.wav",
    ".ssh/frames.gif",
    "keys/id_ed25519",
    "certs/server.pem",
    ".env",
  ])("refuses the project file %s", (rel) => {
    expect(isPrivateUnderAssetRoots(file(rel), roots)).toBe(true);
    expect(assetRootsRefusal(file(rel), roots)).toBe("a private project file");
  });

  it("refuses a link whose target is a private project file", () => {
    const link = join(projectDir, "clip.mp4");
    symlinkSync(file(".git/config"), link);
    expect(isPrivateUnderAssetRoots(link, roots)).toBe(true);
  });

  it("refuses a private project file named through a link outside the project, when asked to follow it", () => {
    const alias = join(root, "alias");
    symlinkSync(projectDir, alias);
    const named = join(alias, ".git", "objects", "clip.mp4");
    file(".git/objects/clip.mp4");
    expect(isPrivateUnderAssetRoots(named, roots)).toBe(false);
    expect(isPrivateUnderAssetRoots(named, roots, true)).toBe(true);
    expect(
      isPrivateUnderAssetRoots(
        join(alias, file("media/clip.mp4").slice(projectDir.length)),
        roots,
        true,
      ),
    ).toBe(false);
    const outside = join(root, ".ssh", "clip.mp4");
    mkdirSync(dirname(outside), { recursive: true });
    writeFileSync(outside, "x");
    expect(isPrivateUnderAssetRoots(outside, roots, true)).toBe(false);
  });

  it("keeps project media and the render's own files inside .hyperframes", () => {
    expect(isPrivateUnderAssetRoots(file("media/clip.mp4"), roots)).toBe(false);
    expect(assetRootsRefusal(file("media/clip.mp4"), roots)).toBeNull();
    const downloaded = file(".hyperframes/share-renders/work/downloads/remote.mp4");
    expect(isPrivateUnderAssetRoots(downloaded, roots)).toBe(false);
  });

  it("leaves a file outside every root to the containment check", () => {
    const outside = join(root, ".git", "config");
    mkdirSync(dirname(outside), { recursive: true });
    writeFileSync(outside, "x");
    expect(isPrivateUnderAssetRoots(outside, roots)).toBe(false);
    expect(assetRootsRefusal(outside, roots)).toBe("outside the project folder");
  });
});
