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
const readme = () =>
  readFileSync(resolve(root, "docs/video-sources/catalog-overview/README.md"), "utf8");
const preparer = () =>
  readFileSync(resolve(root, "scripts/catalog-overview-video/prepare-assets.ts"), "utf8");

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
    for (const [index, asset] of catalogOverviewAssets.entries()) {
      expect(html).toContain(`assets/${asset.item}.mp4`);
      expect(html).toContain(`>${asset.section}<`);

      const videoStart = html.indexOf(`id="catalog-${asset.item}"`);
      const labelStart = html.indexOf(`id="catalog-${asset.item}-label"`);
      const video = html.slice(videoStart, labelStart);
      const label = html.slice(labelStart, html.indexOf("</div>", labelStart));
      const start = String(index * 1.75);
      expect(videoStart).toBeGreaterThan(-1);
      expect(labelStart).toBeGreaterThan(videoStart);
      expect(video).toContain(`data-start="${start}"`);
      expect(video).toContain('data-duration="1.75"');
      expect(Number(video.match(/data-media-start="([\d.]+)"/)?.[1])).toBe(asset.mediaStart);
      expect(video).toContain('data-track-index="0"');
      expect(label).toContain(`data-start="${start}"`);
      expect(label).toContain('data-duration="1.75"');
      expect(label).toContain('data-track-index="1"');
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
    expect(player()).toContain('id="fallback"');
    expect(player()).toContain("media.addEventListener('playing'");
    expect(player()).toContain("media.addEventListener('error'");
    expect(player()).toContain("event.source!==player.iframeElement.contentWindow");
    expect(readme()).toContain("catalog-overview-v3.jpg");
    expect(preparer().indexOf("if (asset.localFile)")).toBeLessThan(
      preparer().indexOf("if (existsSync(file))"),
    );
    expect(mdx).not.toContain("## Before you keep it");
    expect(mdx).not.toContain("## Start with the job");
    expect((mdx.match(/<Card /g) ?? []).length).toBe(2);
  });
});
