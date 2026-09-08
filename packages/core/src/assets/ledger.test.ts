import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAssetLedger,
  buildProjectAssetLedger,
  classifyAssetUrl,
  collectProjectHtmlFiles,
  extractAssetRefs,
} from "./ledger";

// A representative composition: one CDN script (jsDelivr), local media, a
// data URI, a missing reference, and CSS-declared assets.
const FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="styles/theme.css">
  <link rel="preload" as="font" href="assets/fonts/Inter.woff2" crossorigin>
  <style>
    @import url("https://cdn.example.com/base.css");
    @font-face {
      font-family: "Brand";
      src: url("assets/fonts/brand.woff2") format("woff2");
    }
    .hero { background-image: url('assets/img/bg.png'); }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    // Markup inside a script string must NOT register as a tag:
    const tpl = "<img src='https://evil.example.com/x.png'>";
  </script>
</head>
<body>
  <div class="clip" style="background: url(assets/img/inline.png)">
    <img src="assets/img/logo.png" srcset="assets/img/logo.png 1x, assets/img/logo@2x.png 2x">
    <video src="assets/video/intro.mp4" poster="assets/img/poster.jpg"></video>
    <audio src="assets/audio/bgm.mp3"></audio>
    <picture>
      <source srcset="assets/img/hero.avif" type="image/avif">
      <img src="assets/img/hero.png">
    </picture>
    <iframe src="https://example.com/embed"></iframe>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
    <img src="assets/img/definitely-missing.png">
  </div>
  <!-- <script src="https://commented-out.example.com/never.js"></script> -->
</body>
</html>`;

describe("classifyAssetUrl", () => {
  it("classifies remote, data, and local candidates", () => {
    expect(classifyAssetUrl("https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js")).toBe("remote");
    expect(classifyAssetUrl("http://example.com/a.js")).toBe("remote");
    expect(classifyAssetUrl("//cdn.example.com/a.js")).toBe("remote");
    expect(classifyAssetUrl("data:image/png;base64,AAAA")).toBe("data");
    expect(classifyAssetUrl("assets/img/logo.png")).toBe("local-candidate");
    expect(classifyAssetUrl("/assets/img/logo.png")).toBe("local-candidate");
  });

  it("skips fragments, runtime schemes, and templating placeholders", () => {
    expect(classifyAssetUrl("")).toBe("skip");
    expect(classifyAssetUrl("#anchor")).toBe("skip");
    expect(classifyAssetUrl("blob:https://x/y")).toBe("skip");
    expect(classifyAssetUrl("javascript:void(0)")).toBe("skip");
    expect(classifyAssetUrl("about:blank")).toBe("skip");
    expect(classifyAssetUrl("{{ heroImage }}")).toBe("skip");
    expect(classifyAssetUrl("__POSTER__")).toBe("skip");
  });

  it("marks unknown schemes as remote so --strict-offline surfaces them", () => {
    expect(classifyAssetUrl("ftp://host/file.png")).toBe("remote");
  });
});

describe("extractAssetRefs", () => {
  const refs = extractAssetRefs(FIXTURE_HTML);
  const find = (url: string) => refs.find((r) => r.url === url);

  it("finds remote script tags but not scripts inside string literals or comments", () => {
    const script = find("https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js");
    expect(script).toMatchObject({ kind: "script", via: "src" });
    expect(find("https://evil.example.com/x.png")).toBeUndefined();
    expect(find("https://commented-out.example.com/never.js")).toBeUndefined();
  });

  it("classifies link tags by rel/as", () => {
    expect(find("styles/theme.css")).toMatchObject({ kind: "stylesheet", via: "href" });
    expect(find("assets/fonts/Inter.woff2")).toMatchObject({ kind: "font", via: "href" });
  });

  it("extracts CSS @import, @font-face urls, and background urls", () => {
    expect(find("https://cdn.example.com/base.css")).toMatchObject({
      kind: "stylesheet",
      via: "css-import",
    });
    expect(find("assets/fonts/brand.woff2")).toMatchObject({ kind: "font", via: "css-url" });
    expect(find("assets/img/bg.png")).toMatchObject({ kind: "image", via: "css-url" });
    expect(find("assets/img/inline.png")).toMatchObject({ kind: "image", via: "style-attr" });
  });

  it("extracts media elements including srcset, poster, and picture sources", () => {
    expect(find("assets/video/intro.mp4")).toMatchObject({ kind: "video", via: "src" });
    expect(find("assets/img/poster.jpg")).toMatchObject({ kind: "image", via: "poster" });
    expect(find("assets/audio/bgm.mp3")).toMatchObject({ kind: "audio", via: "src" });
    expect(find("assets/img/logo@2x.png")).toMatchObject({ kind: "image", via: "srcset" });
    expect(find("assets/img/hero.avif")).toMatchObject({ kind: "image", via: "srcset" });
    expect(find("https://example.com/embed")).toMatchObject({ kind: "iframe", via: "src" });
  });

  it("maps <source src> inside <video> and <audio> to the parent kind", () => {
    const html = `<video><source src="a.mp4"></video><audio><source src="b.mp3"></audio>`;
    const sourceRefs = extractAssetRefs(html);
    expect(sourceRefs).toEqual([
      expect.objectContaining({ kind: "video", url: "a.mp4" }),
      expect.objectContaining({ kind: "audio", url: "b.mp3" }),
    ]);
  });

  it("decodes HTML entities in URLs but keeps the raw text for rewriting", () => {
    const html = `<script src="https://cdn.example.com/a.js?v=1&amp;x=2"></script>`;
    const [ref] = extractAssetRefs(html);
    expect(ref?.url).toBe("https://cdn.example.com/a.js?v=1&x=2");
    expect(ref?.rawUrl).toBe("https://cdn.example.com/a.js?v=1&amp;x=2");
  });
});

describe("buildAssetLedger", () => {
  it("classifies statuses via the resolver and counts them", () => {
    const localFiles = new Set([
      "styles/theme.css",
      "assets/fonts/Inter.woff2",
      "assets/fonts/brand.woff2",
      "assets/img/bg.png",
      "assets/img/inline.png",
      "assets/img/logo.png",
      "assets/img/logo@2x.png",
      "assets/img/poster.jpg",
      "assets/img/hero.avif",
      "assets/img/hero.png",
      "assets/video/intro.mp4",
      "assets/audio/bgm.mp3",
    ]);
    const ledger = buildAssetLedger([{ file: "index.html", html: FIXTURE_HTML }], {
      resolveLocalAsset: (_fromFile, url) => (localFiles.has(url) ? url : null),
    });

    expect(ledger.files).toEqual(["index.html"]);
    // jsDelivr script + @import stylesheet + iframe embed
    expect([...ledger.remoteUrls].sort()).toEqual([
      "https://cdn.example.com/base.css",
      "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js",
      "https://example.com/embed",
    ]);
    expect(ledger.counts.remote).toBe(3);
    expect(ledger.counts.data).toBe(1);
    expect(ledger.counts.missing).toBe(1);
    // Counts are per-reference: logo.png appears in both src and srcset.
    expect(ledger.counts.local).toBe(localFiles.size + 1);
    expect(ledger.counts.total).toBe(
      ledger.counts.remote + ledger.counts.local + ledger.counts.data + ledger.counts.missing,
    );

    const missing = ledger.assets.filter((a) => a.status === "missing");
    expect(missing).toEqual([
      expect.objectContaining({ url: "assets/img/definitely-missing.png", kind: "image" }),
    ]);
  });

  it("dedupes remote URLs across files but keeps every reference", () => {
    const html = `<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>`;
    const ledger = buildAssetLedger([
      { file: "index.html", html },
      { file: "scenes/intro.html", html },
    ]);
    expect(ledger.remoteUrls).toHaveLength(1);
    expect(ledger.assets).toHaveLength(2);
    expect(ledger.counts.remote).toBe(2);
  });

  it("reports local candidates as missing when no resolver is provided", () => {
    const ledger = buildAssetLedger([{ file: "index.html", html: `<img src="a.png">` }]);
    expect(ledger.counts.missing).toBe(1);
  });
});

describe("buildProjectAssetLedger", () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("scans HTML files on disk and resolves local assets file-relative", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-ledger-"));
    mkdirSync(join(dir, "assets", "img"), { recursive: true });
    mkdirSync(join(dir, "scenes"));
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "assets", "img", "logo.png"), "png");
    writeFileSync(
      join(dir, "index.html"),
      `<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
       <img src="assets/img/logo.png">`,
    );
    writeFileSync(
      join(dir, "scenes", "intro.html"),
      `<img src="../assets/img/logo.png"><img src="missing.png">`,
    );
    // Must be ignored by the walk:
    writeFileSync(join(dir, "node_modules", "pkg", "ignored.html"), `<img src="x.png">`);

    expect(collectProjectHtmlFiles(dir)).toEqual(["index.html", "scenes/intro.html"]);

    const ledger = buildProjectAssetLedger(dir);
    expect(ledger.counts.remote).toBe(1);
    expect(ledger.counts.local).toBe(2);
    expect(ledger.counts.missing).toBe(1);

    const fromScene = ledger.assets.find(
      (a) => a.file === "scenes/intro.html" && a.status === "local",
    );
    expect(fromScene?.localPath).toBe("assets/img/logo.png");
  });
});
