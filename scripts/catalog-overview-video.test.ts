import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { catalogOverviewAssets } from "./catalog-overview-video/assets";

const root = resolve(import.meta.dirname, "..");
const composition = () =>
  readFileSync(resolve(root, "docs/video-sources/catalog-overview/index.html"), "utf8");
const page = () => readFileSync(resolve(root, "docs/catalog/index.mdx"), "utf8");
const player = () =>
  readFileSync(resolve(root, "docs/snippets/catalog-overview-player.jsx"), "utf8");

const sections = [
  "Code Animations",
  "Captions",
  "HTML-in-Canvas",
  "Social Overlays",
  "Lower Thirds",
  "Shader Transitions",
  "CSS Transitions",
  "Showcases",
  "Data",
  "Effects",
  "Blocks",
];

describe("Catalog overview montage", () => {
  test("covers every Catalog section exactly once in sidebar order", () => {
    expect(catalogOverviewAssets.map(({ section }) => section)).toEqual(sections);
    expect(new Set(catalogOverviewAssets.map(({ item }) => item)).size).toBe(sections.length);
    expect(catalogOverviewAssets[1]?.item).toBe("caption-camera-follow");
    expect(catalogOverviewAssets[2]?.item).toBe("vfx-iphone-device");
    expect(catalogOverviewAssets[7]?.item).toBe("ai-chat-reveal");
  });

  test("mounts every frozen asset and visible section label", () => {
    const html = composition();
    for (const asset of catalogOverviewAssets) {
      expect(html).toContain(`assets/${asset.item}.mp4`);
      expect(html).toContain(`>${asset.section}<`);
    }
    expect(html).toContain('data-composition-id="catalog-overview"');
    expect(html).toContain('data-duration="19.25"');
    expect(html).toContain('data-fps="60"');
  });

  test("keeps the overview short and uses the v3 HyperFrames player", () => {
    const mdx = page();
    expect(mdx).toContain(
      'import { CatalogOverviewPlayer } from "/snippets/catalog-overview-player.jsx"',
    );
    expect(mdx).toContain("<CatalogOverviewPlayer");
    expect(mdx).toContain("catalog-overview-v3.mp4");
    expect(mdx).toContain("catalog-overview-v3.html");
    expect(mdx).not.toContain("catalog-overview-v1");
    expect(player()).toContain("document.createElement('hyperframes-player')");
    expect(player()).toContain('["code", "HTML"]');
    expect(player()).toContain("/images/showcase/catalog-overview-v3.mp4");
    expect(player()).toContain("window.__timelines['catalog-overview-v3']");
    expect(mdx).not.toContain("## Before you keep it");
    expect(mdx).not.toContain("## Start with the job");
    expect((mdx.match(/<Card /g) ?? []).length).toBe(2);
  });
});
