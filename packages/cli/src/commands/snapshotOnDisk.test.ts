import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearEarlierStills, clearedNote, snapshotsOnDisk } from "./snapshot.js";

describe("snapshotsOnDisk", () => {
  it("counts only the stills that exist with bytes, and names the others", () => {
    const project = mkdtempSync(join(tmpdir(), "hf-snap-disk-"));
    mkdirSync(join(project, "shots"));
    writeFileSync(join(project, "shots", "a.png"), "png");
    writeFileSync(join(project, "shots", "empty.png"), "");
    const result = snapshotsOnDisk(project, ["shots/a.png", "shots/empty.png", "shots/gone.png"]);
    expect(result.written).toEqual([join(project, "shots", "a.png")]);
    expect(result.missing).toEqual([
      join(project, "shots", "empty.png"),
      join(project, "shots", "gone.png"),
    ]);
  });

  it("resolves a project-relative path against the project, not the caller's directory", () => {
    const project = mkdtempSync(join(tmpdir(), "hf-snap-disk-"));
    const elsewhere = mkdtempSync(join(tmpdir(), "hf-snap-cwd-"));
    writeFileSync(join(project, "frame.png"), "png");
    const before = process.cwd();
    process.chdir(elsewhere);
    try {
      expect(snapshotsOnDisk(project, ["frame.png"]).written).toEqual([join(project, "frame.png")]);
    } finally {
      process.chdir(before);
    }
  });

  it("does not count a frame the run skipped on purpose, such as a --zoom target that is not visible", () => {
    const project = mkdtempSync(join(tmpdir(), "hf-snap-disk-"));
    writeFileSync(join(project, "frame-02-at-2s.png"), "png");
    // The skipped frames never reach the run's list of captured paths, so nothing is reported missing.
    expect(snapshotsOnDisk(project, ["frame-02-at-2s.png"]).missing).toEqual([]);
  });

  it("keeps an absolute path as it is", () => {
    const folder = mkdtempSync(join(tmpdir(), "hf-snap-abs-"));
    writeFileSync(join(folder, "x.png"), "png");
    expect(snapshotsOnDisk("/not/the/project", [join(folder, "x.png")]).written).toHaveLength(1);
  });
});

describe("clearEarlierStills", () => {
  it("removes an earlier run's stills, says how many and where, and leaves other files", () => {
    const folder = mkdtempSync(join(tmpdir(), "hf-snap-clear-"));
    writeFileSync(join(folder, "frame-00-at-0.5s.png"), "png");
    writeFileSync(join(folder, "frame-01-at-2s.png"), "png");
    writeFileSync(join(folder, "notes.txt"), "keep");
    const cleared = clearEarlierStills(folder);
    expect(cleared.sort()).toEqual([
      join(folder, "frame-00-at-0.5s.png"),
      join(folder, "frame-01-at-2s.png"),
    ]);
    expect(existsSync(join(folder, "frame-00-at-0.5s.png"))).toBe(false);
    expect(existsSync(join(folder, "notes.txt"))).toBe(true);
    expect(clearedNote(cleared.length, folder)).toBe(
      `cleared 2 stills from an earlier run in ${folder}`,
    );
  });

  it("clears nothing from a folder that has no earlier stills, or does not exist", () => {
    expect(clearEarlierStills(mkdtempSync(join(tmpdir(), "hf-snap-clear-")))).toEqual([]);
    expect(clearEarlierStills(join(tmpdir(), "hf-snap-no-such-folder"))).toEqual([]);
  });
});
