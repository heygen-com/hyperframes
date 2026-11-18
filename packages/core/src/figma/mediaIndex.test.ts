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

// The media-use generator itself, resolved from THIS file (cwd varies per test runner) and
// handed over as a file:// URL so the specifier is valid on windows too.
const genUrl = pathToFileURL(
  join(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "packages",
    "cli",
    "src",
    "media-use",
    "lib",
    "index-gen.mjs",
  ),
).href;

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

  it("lists only a path's newest record, the same rows media-use's writer picks", () => {
    const p = project();
    const regenerated = { ...MEDIA_USE_ROW, description: "calm underscore" };
    for (const row of [MEDIA_USE_ROW, FIGMA_ROW, regenerated]) {
      appendFileSync(manifestPath(p), JSON.stringify(row) + "\n");
    }
    const ours = regenerateIndex(p);
    const script = `
      import { regenerateIndex } from ${JSON.stringify(genUrl)};
      process.stdout.write(regenerateIndex(${JSON.stringify(p)}));
    `;
    const theirs = execFileSync("node", ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    expect(ours).toContain("calm underscore");
    expect(ours).not.toContain("upbeat tech launch");
    expect(ours).toBe(theirs);
  });
});

describe("generateIndexContent with line breaks and control characters in a row", () => {
  const BROKEN_ROWS = [
    { ...IMAGE_ROW, id: "image_009\r\n", description: "first line\nsecond line\r\n  third" },
    { ...ICON_ROW, path: ".media/images/\nicon.svg", description: "\n" },
    {
      ...IMAGE_ROW,
      id: "image_010",
      description: "a\u2028b\u2029c\u0085d\u000be\u000cf",
    },
    {
      ...IMAGE_ROW,
      id: "image_011\u0000",
      description: "red\u001b[31m\u0007 bell\u007f\u009b\ttab",
    },
  ];

  it("keeps each row on one line", () => {
    const lines = generateIndexContent(BROKEN_ROWS)
      .trimEnd()
      .split(/\r\n|[\n\r\v\f\u0085\u2028\u2029]/);
    // Title, blank line, column heading, then one line per row.
    expect(lines).toHaveLength(3 + BROKEN_ROWS.length);
    expect(lines[3]).toContain("first line second line third");
    expect(lines[5]).toContain("a b c d e f");
  });

  it("shows other control characters as visible escapes and keeps tabs", () => {
    const content = generateIndexContent(BROKEN_ROWS);
    const controls = [...content].filter((ch) => {
      const code = ch.charCodeAt(0);
      return (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
    });
    expect(controls).toEqual([]);
    expect(content).toContain("image_011\\x00");
    expect(content).toContain("red\\x1b[31m\\x07 bell\\x7f\\x9b\ttab");
  });

  it("matches media-use's index-gen output byte-for-byte", () => {
    const script = `
      import { generateIndexContent } from ${JSON.stringify(genUrl)};
      process.stdout.write(generateIndexContent(${JSON.stringify(BROKEN_ROWS)}));
    `;
    const theirs = execFileSync("node", ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    expect(generateIndexContent(BROKEN_ROWS)).toBe(theirs);
  });
});
