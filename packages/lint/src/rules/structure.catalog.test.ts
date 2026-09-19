import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter";

const REPO_ROOT = resolve(__dirname, "../../../..");
const STRUCTURE_CODES = new Set([
  "nested_structure_needs_subcomposition",
  "timeline_element_missing_timing",
  "caption_track_kind_missing",
  "multiple_caption_tracks",
]);

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

describe("structure rules on the shipped catalog and skills", () => {
  it("report nothing for any registry item or skill example", async () => {
    const files = [
      ...htmlFiles(join(REPO_ROOT, "registry")),
      ...htmlFiles(join(REPO_ROOT, "skills")),
    ];
    const hits: string[] = [];
    let roots = 0;
    for (const file of files) {
      const isRoot = file.endsWith("/index.html");
      roots += isRoot ? 1 : 0;
      const { findings } = await lintHyperframeHtml(readFileSync(file, "utf8"), {
        host: "studio",
        filePath: file,
        isSubComposition: !isRoot,
      });
      for (const f of findings.filter((x) => STRUCTURE_CODES.has(x.code)))
        hits.push(`${file}: ${f.code}`);
    }
    expect(roots).toBeGreaterThan(30);
    expect(hits).toEqual([]);
  }, 120_000);
});
