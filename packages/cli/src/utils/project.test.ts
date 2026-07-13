import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { InvalidProjectError, resolveProjectOrThrow } from "./project.js";

describe("resolveProjectOrThrow", () => {
  it("rejects # as a project directory with a helpful message", () => {
    try {
      resolveProjectOrThrow("#");
      expect.unreachable("expected InvalidProjectError");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidProjectError);
      const error = err as InvalidProjectError;
      expect(error.title).toBe("Invalid project directory: #");
      expect(error.hint).toContain("URL fragment");
      expect(error.suggestion).toContain("hyperframes preview .");
    }
  });

  it("rejects a missing directory", () => {
    const missing = join(tmpdir(), `hf-missing-${Date.now()}`);
    expect(() => resolveProjectOrThrow(missing)).toThrowError(/Not a directory/);
  });

  it("rejects a directory without index.html", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-empty-project-"));
    try {
      expect(() => resolveProjectOrThrow(dir)).toThrowError(/No composition found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a directory without index.html when an explicit entry will be resolved", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-explicit-entry-project-"));
    try {
      const project = resolveProjectOrThrow(dir, { requireIndex: false });
      expect(project.dir).toBe(dir);
      expect(project.indexPath).toBe(join(dir, "index.html"));
      expect(project.name).toBe(basename(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a directory with index.html", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-valid-project-"));
    try {
      writeFileSync(join(dir, "index.html"), '<html data-composition-id="test"></html>');
      const project = resolveProjectOrThrow(dir);
      expect(project.dir).toBe(dir);
      expect(project.indexPath).toBe(join(dir, "index.html"));
      expect(project.name).toBe(basename(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
