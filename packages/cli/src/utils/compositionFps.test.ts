import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCloudFps, readCompositionFps } from "./compositionFps.js";

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

describe("defaultCloudFps", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
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

  function root(fps: string): string {
    return makeProject(
      `<div data-composition-id="root" data-root="true" data-fps="${fps}">x</div>`,
    );
  }

  it.each([24, 25, 30, 60])("uses a supported data-fps=%i without warning", (fps) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(defaultCloudFps(root(String(fps)))).toBe(fps);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["48", "50", "30000/1001"])("falls back to 30 and warns for data-fps=%s", (fps) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(defaultCloudFps(root(fps))).toBe(30);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(`data-fps="${fps}"`);
  });

  it("uses 30 without warning when index.html has no data-fps", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      defaultCloudFps(makeProject('<div data-composition-id="root" data-root="true">x</div>')),
    ).toBe(30);
    expect(warn).not.toHaveBeenCalled();
  });

  it("uses 30 without warning when index.html cannot be read", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-composition-fps-missing-"));
    projectDirs.push(dir);
    expect(defaultCloudFps(dir)).toBe(30);
    expect(warn).not.toHaveBeenCalled();
  });
});
