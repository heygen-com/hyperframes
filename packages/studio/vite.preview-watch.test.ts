import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { previewChangeOwner } from "./vite.preview-watch";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Vite preview change ownership", () => {
  it("uses a symlink target's project id and config without leaking into sibling projects", () => {
    const root = mkdtempSync(join(tmpdir(), "hf-vite-watch-"));
    dirs.push(root);
    const a = join(root, "external");
    const b = join(root, "external-other");
    for (const path of [a, b]) mkdirSync(path);
    writeFileSync(
      join(a, "hyperframes.json"),
      JSON.stringify({ preview: { watchIgnore: ["docs"] } }),
    );
    const projects = new Map([
      [a, "symlink-project"],
      [b, "other-project"],
    ]);
    expect(previewChangeOwner(projects, join(a, "index.html"))).toBe("symlink-project");
    expect(previewChangeOwner(projects, join(a, "docs", "report.json"))).toBeNull();
    expect(previewChangeOwner(projects, join(a, "index.html.tmp"))).toBeNull();
    expect(previewChangeOwner(projects, join(b, "docs", "report.json"))).toBe("other-project");
    expect(previewChangeOwner(projects, join(root, "outside.html"))).toBeNull();
  });

  it("uses the nearest project when watched directories are nested", () => {
    const root = mkdtempSync(join(tmpdir(), "hf-vite-watch-"));
    dirs.push(root);
    const nested = join(root, "nested");
    mkdirSync(nested);
    expect(
      previewChangeOwner(
        new Map([
          [root, "root"],
          [nested, "nested"],
        ]),
        join(nested, "index.html"),
      ),
    ).toBe("nested");
  });
});
