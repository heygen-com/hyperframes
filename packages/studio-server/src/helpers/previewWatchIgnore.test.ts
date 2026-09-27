import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizePreviewWatchIgnore, shouldReloadPreview } from "./previewWatchIgnore";

const directories: string[] = [];
function project(config: unknown = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-watch-ignore-"));
  directories.push(dir);
  writeFileSync(join(dir, "hyperframes.json"), JSON.stringify(config));
  return dir;
}
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("preview reload filtering", () => {
  it("defaults to reloading arbitrary assets, data, and source files", () => {
    const dir = project();
    for (const path of [
      "index.html",
      "assets/photo.jpg",
      "data.json",
      "docs/data.md",
      "scene.tsx",
    ]) {
      expect(shouldReloadPreview(dir, path)).toBe(true);
    }
  });

  it("ignores literal paths and directory descendants without matching siblings", () => {
    const dir = project({ preview: { watchIgnore: ["./docs/", "reports\\checks.json"] } });
    for (const path of ["docs", "docs/a.json", "docs\\a.md", "reports/checks.json"]) {
      expect(shouldReloadPreview(dir, path)).toBe(false);
    }
    for (const path of ["docs-other/a.json", "reports/other.json", "index.html"]) {
      expect(shouldReloadPreview(dir, path)).toBe(true);
    }
    expect(shouldReloadPreview(dir, join(dir, "docs", "report.json"))).toBe(false);
  });

  it("always reloads config and reads changed settings without restarting", () => {
    const dir = project({ preview: { watchIgnore: ["docs", "hyperframes.json"] } });
    expect(shouldReloadPreview(dir, "hyperframes.json")).toBe(true);
    expect(shouldReloadPreview(dir, "docs/report.json")).toBe(false);
    writeFileSync(join(dir, "hyperframes.json"), "{}");
    expect(shouldReloadPreview(dir, "docs/report.json")).toBe(true);
  });

  it("ignores atomic-save artifacts while retaining the final source and ordinary names", () => {
    const dir = project();
    for (const path of [
      "index.html.tmp",
      "docs/edit.md.tmp.97896.1d3e1712ad2c",
      ".index.html.swp",
      "index.html.swo",
      "index.html~",
    ]) {
      expect(shouldReloadPreview(dir, path)).toBe(false);
    }
    for (const path of ["index.html", "templates/a.html", "photo.tmp.jpg"]) {
      expect(shouldReloadPreview(dir, path)).toBe(true);
    }
  });

  it("fails open on malformed or missing configuration", () => {
    for (const config of [null, [], { preview: null }, { preview: { watchIgnore: "docs" } }]) {
      expect(shouldReloadPreview(project(config), "docs/report.json")).toBe(true);
    }
    const dir = project();
    writeFileSync(join(dir, "hyperframes.json"), "{");
    expect(shouldReloadPreview(dir, "index.html")).toBe(true);
    rmSync(join(dir, "hyperframes.json"));
    expect(shouldReloadPreview(dir, "index.html")).toBe(true);
  });

  it("rejects exclusions that could hide the whole project or escape its root", () => {
    expect(
      normalizePreviewWatchIgnore([
        "",
        ".",
        "./",
        "..",
        "../a",
        "/tmp",
        "C:\\tmp",
        "a/../b",
        "**",
        null,
        5,
        "docs",
      ]),
    ).toEqual(["docs"]);
    const dir = project();
    expect(shouldReloadPreview(dir, dir)).toBe(false);
    expect(shouldReloadPreview(dir, join(dir, ".."))).toBe(false);
    expect(shouldReloadPreview(dir, join(dir, "..", "other.html"))).toBe(false);
  });
});
