import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderDirectoryMetadata,
  renderMetadataPath,
  removeRenderArtifacts,
} from "./renderArtifactFs";

describe("render artifact filesystem helpers", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function root(): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-render-artifacts-"));
    roots.push(dir);
    return dir;
  }

  it("places the sidecar beside the output by job id, for files and extensionless directories", () => {
    expect(renderMetadataPath("/p/renders/job.mp4", "job")).toBe("/p/renders/job.meta.json");
    expect(renderMetadataPath("/p/renders/job", "job")).toBe("/p/renders/job.meta.json");
  });

  it("returns directory facts for a directory and nothing for a file", () => {
    const dir = root();
    const seq = join(dir, "job");
    mkdirSync(seq);
    writeFileSync(join(seq, "frame_000000.png"), "abc");
    writeFileSync(join(dir, "job.mp4"), "x");
    expect(renderDirectoryMetadata(seq)).toEqual({ frameCount: 1, size: 3, audioSidecar: false });
    expect(renderDirectoryMetadata(join(dir, "job.mp4"))).toEqual({});
    expect(renderDirectoryMetadata(join(dir, "missing"))).toEqual({});
  });

  it("removes a directory output recursively, a file output, and the sidecar; tolerates missing paths", () => {
    const dir = root();
    const seq = join(dir, "job");
    mkdirSync(join(seq, "nested"), { recursive: true });
    writeFileSync(join(seq, "nested", "frame_000000.png"), "a");
    writeFileSync(join(dir, "job.meta.json"), "{}");
    writeFileSync(join(dir, "other.mp4"), "x");

    removeRenderArtifacts([seq, join(dir, "missing"), join(dir, "job.meta.json")]);
    removeRenderArtifacts([join(dir, "other.mp4")]);

    expect(existsSync(seq)).toBe(false);
    expect(existsSync(join(dir, "job.meta.json"))).toBe(false);
    expect(existsSync(join(dir, "other.mp4"))).toBe(false);
  });

  it("unlinks a symlinked output without touching its target", (context) => {
    const dir = root();
    const target = join(dir, "outside");
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "keep");
    const link = join(dir, "job");
    try {
      symlinkSync(target, link, "dir");
    } catch {
      context.skip();
      return;
    }
    removeRenderArtifacts([link]);
    expect(existsSync(link)).toBe(false);
    expect(readFileSync(join(target, "keep.txt"), "utf-8")).toBe("keep");
  });
});
