import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { prepareProjectDir, preparedCompositionEntry } from "./registry.ts";
import type { RegistryItem } from "./types.ts";

describe("eval registry project preparation", () => {
  it("renders an anime.js standalone composition from its own entry file", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hf-registry-standalone-"));
    try {
      const sourceDir = join(tempDir, "source");
      const entryFile = "anime.html";
      mkdirSync(sourceDir);
      writeFileSync(
        join(sourceDir, entryFile),
        `<div data-composition-id="x"></div>
<script>hyperframesAnime.register("x", timeline);</script>`,
      );

      const item: RegistryItem = {
        key: "block/anime-standalone",
        name: "anime-standalone",
        kind: "block",
        sourceDir,
        itemDirRelative: "source",
        entryFile,
        dimensions: { width: 1920, height: 1080 },
        duration: 5,
        fps: 30,
        notes: [],
      };

      const projectDir = prepareProjectDir(item, tempDir);

      assert.equal(preparedCompositionEntry(projectDir, item), entryFile);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
