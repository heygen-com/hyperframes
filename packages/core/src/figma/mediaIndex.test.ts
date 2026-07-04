// @vitest-environment node
import { describe, expect, it, afterEach } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { generateIndexContent, indexPath, regenerateIndex } from "./mediaIndex";
import { manifestPath } from "./manifest";

const dirs: string[] = [];
function project(): string {
  const d = mkdtempSync(join(tmpdir(), "hf-media-index-"));
  dirs.push(d);
  mkdirSync(join(d, ".media"), { recursive: true });
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MEDIA_USE_ROW = {
  id: "bgm_001",
  type: "bgm",
  path: ".media/audio/bgm/bgm_001.mp3",
  source: "search",
  description: "upbeat tech launch",
  duration: 25,
  provenance: { provider: "heygen-audio", prompt: "upbeat tech launch" },
};
const IMAGE_ROW = {
  id: "image_001",
  type: "image",
  path: ".media/images/image_001.jpg",
  source: "search",
  description: "gradient tech background",
  width: 1920,
  height: 1080,
  provenance: { provider: "heygen-asset", prompt: "gradient tech background" },
};
const ICON_ROW = {
  id: "icon_001",
  type: "icon",
  path: ".media/images/icon_001.svg",
  source: "search",
  description: "rocket",
  transparent: true,
  provenance: { provider: "heygen-asset", prompt: "rocket" },
};
const FIGMA_ROW = {
  id: "image_002",
  type: "image",
  path: ".media/images/image_002.svg",
  source: "figma:KEY/1:2",
  description: "hero illustration",
  entity: "Acme hero",
  provenance: { source: "figma", fileKey: "KEY", nodeId: "1:2", version: "9", format: "svg" },
};
// media-use renders every JSON-parseable row, shape or no shape — selection
// parity matters as much as format parity.
const JUNK_ROW = { note: "not a media record" };
const ALL_ROWS = [MEDIA_USE_ROW, IMAGE_ROW, ICON_ROW, FIGMA_ROW, JUNK_ROW];

describe("regenerateIndex", () => {
  it("renders every writer's rows (media-use + figma) into one table", () => {
    const p = project();
    for (const row of ALL_ROWS) appendFileSync(manifestPath(p), JSON.stringify(row) + "\n");
    regenerateIndex(p);
    const index = readFileSync(indexPath(p), "utf8");
    expect(index).toContain("# .media · 5 assets");
    expect(index).toContain("25s");
    expect(index).toContain("1920×1080");
    expect(index).toContain("hero illustration");
  });

  it("matches media-use's index-gen output byte-for-byte on the same rows", () => {
    // Covers duration, width×height, icon+transparent, no-dims, and junk-row
    // selection — the full set of branches both generators format.
    const ours = generateIndexContent(ALL_ROWS as Record<string, unknown>[]);
    // Run the actual media-use generator on identical input. Resolve the
    // script relative to THIS file (cwd varies per test runner) and hand it
    // over as a file:// URL so the specifier is valid on windows too.
    const genUrl = pathToFileURL(
      join(
        fileURLToPath(new URL(".", import.meta.url)),
        "..",
        "..",
        "..",
        "..",
        "skills",
        "media-use",
        "scripts",
        "lib",
        "index-gen.mjs",
      ),
    ).href;
    const script = `
      import { generateIndexContent } from ${JSON.stringify(genUrl)};
      const rows = ${JSON.stringify(ALL_ROWS)};
      process.stdout.write(generateIndexContent(rows));
    `;
    const theirs = execFileSync("node", ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    expect(ours).toBe(theirs);
  });
});
