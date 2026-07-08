import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { discoverRegistryItems } from "./registry.ts";
import { createEmptyManifest, recordManifestEntry } from "./manifest.ts";

const FORK_SHA = "17b852784bf3922a42b3aa9801db647423073a13";

describe("GSAP baseline registry discovery", () => {
  it("discovers all 147 registry items with stable manifest keys", () => {
    const items = discoverRegistryItems();

    assert.equal(items.length, 147);
    assert.equal(items.filter((item) => item.kind === "block").length, 109);
    assert.equal(items.filter((item) => item.kind === "component").length, 25);
    assert.equal(items.filter((item) => item.kind === "example").length, 13);
    assert.equal(new Set(items.map((item) => item.key)).size, items.length);

    const dataChart = items.find((item) => item.key === "block/data-chart");
    assert.equal(dataChart?.entryFile, "data-chart.html");
    assert.equal(dataChart?.dimensions.width, 1920);
    assert.equal(dataChart?.duration, 15);

    const slideshow = items.find((item) => item.key === "example/slideshow-demo");
    assert.equal(slideshow?.entryFile, "index.html");
    assert.equal(slideshow?.duration, 32);
  });
});

describe("GSAP baseline manifest", () => {
  it("records one entry per discovered item and preserves render metadata shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-baseline-manifest-"));
    try {
      const items = discoverRegistryItems();
      let manifest = createEmptyManifest({
        baselineDir: dir,
        forkSha: FORK_SHA,
        generatedAt: "2026-07-08T00:00:00.000Z",
      });

      for (const item of items) {
        manifest = recordManifestEntry(manifest, {
          item,
          forkSha: FORK_SHA,
          relativeVideoPath: `17b852784/${item.kind}/${item.name}.mp4`,
          status: "success",
          renderedAt: "2026-07-08T00:00:00.000Z",
          renderDurationMs: 1,
        });
      }

      assert.equal(manifest.entries.length, 147);
      assert.equal(
        manifest.entries.every((entry) => entry.fork_sha === FORK_SHA),
        true,
      );
      assert.equal(
        manifest.entries.every((entry) => entry.status === "success"),
        true,
      );
      assert.equal(
        manifest.entries.every((entry) => entry.baseline_video_path.endsWith(".mp4")),
        true,
      );
      assert.equal(manifest.entries[0]?.fps, 30);
      assert.equal(typeof manifest.entries[0]?.dimensions.width, "number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
