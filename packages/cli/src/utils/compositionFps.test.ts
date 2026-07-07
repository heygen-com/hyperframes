import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAllowedCompositionFpsFromDir, readCompositionFps } from "./compositionFps.js";

const wrap = (body: string) => `<!DOCTYPE html><html><body>${body}</body></html>`;

describe("readCompositionFps", () => {
  it("reads data-fps from the explicit data-root composition element", () => {
    const html = wrap('<div data-composition-id="root" data-root="true" data-fps="24">x</div>');
    expect(readCompositionFps(html)).toBe("24");
  });

  it("reads data-fps from the outermost composition when no data-root is marked", () => {
    const html = wrap(
      '<div data-composition-id="root" data-fps="48"><div data-composition-id="child" data-fps="12">x</div></div>',
    );
    expect(readCompositionFps(html)).toBe("48");
  });

  it("preserves a fractional rate verbatim for parseFps to validate", () => {
    const html = wrap(
      '<div data-composition-id="root" data-root="true" data-fps="30000/1001">x</div>',
    );
    expect(readCompositionFps(html)).toBe("30000/1001");
  });

  it("returns null when the root has no data-fps", () => {
    expect(readCompositionFps(wrap('<div data-composition-id="root">x</div>'))).toBeNull();
  });

  it("returns null when there is no composition root", () => {
    expect(readCompositionFps(wrap("<div>plain</div>"))).toBeNull();
  });

  it("returns null for a blank data-fps", () => {
    expect(
      readCompositionFps(wrap('<div data-composition-id="root" data-fps="  ">x</div>')),
    ).toBeNull();
  });
});

describe("readAllowedCompositionFpsFromDir", () => {
  const projectDirs: string[] = [];
  const allowedCloudFps = [24, 30, 60] as const;

  afterEach(() => {
    for (const dir of projectDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeProject(indexBody: string): string {
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-composition-fps-"));
    projectDirs.push(dir);
    writeFileSync(join(dir, "index.html"), wrap(indexBody));
    return dir;
  }

  it("uses cloud-allowed data-fps=60 as the default", () => {
    const dir = makeProject(
      '<div data-composition-id="root" data-root="true" data-fps="60">x</div>',
    );

    expect(readAllowedCompositionFpsFromDir(dir, allowedCloudFps)).toBe(60);
  });

  it("uses cloud-allowed data-fps=24 as the default", () => {
    const dir = makeProject(
      '<div data-composition-id="root" data-root="true" data-fps="24">x</div>',
    );

    expect(readAllowedCompositionFpsFromDir(dir, allowedCloudFps)).toBe(24);
  });

  it("returns null for data-fps=48 so cloud callers keep their ?? 30 fallback", () => {
    const dir = makeProject(
      '<div data-composition-id="root" data-root="true" data-fps="48">x</div>',
    );

    const declared = readAllowedCompositionFpsFromDir(dir, allowedCloudFps);
    expect(declared).toBeNull();
    expect(declared ?? 30).toBe(30);
  });

  it("returns null for fractional data-fps because cloud fps must be an integer", () => {
    const dir = makeProject(
      '<div data-composition-id="root" data-root="true" data-fps="30000/1001">x</div>',
    );

    expect(readAllowedCompositionFpsFromDir(dir, allowedCloudFps)).toBeNull();
  });

  it("returns null when index.html has no data-fps", () => {
    const dir = makeProject('<div data-composition-id="root" data-root="true">x</div>');

    expect(readAllowedCompositionFpsFromDir(dir, allowedCloudFps)).toBeNull();
  });

  it("returns null when index.html cannot be read", () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-composition-fps-missing-"));
    projectDirs.push(dir);

    expect(readAllowedCompositionFpsFromDir(dir, allowedCloudFps)).toBeNull();
  });
});
