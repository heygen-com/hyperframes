import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lintHyperframeHtml } from "./hyperframeLinter.js";
import { lintProject } from "./project.js";

// postcss looks for a previous map here; it is where a sourceMappingURL comment's path would be opened.
const PreviousMap = createRequire(import.meta.url)("postcss/lib/previous-map") as {
  prototype: { loadAnnotation(css: string): void };
};

const MAP_COMMENT = "/*# sourceMappingURL=../elsewhere/styles.css.map */";

function page(style: string): string {
  return `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div id="floor" style="width:11000px;height:5200px;transform:translateZ(-1800px) rotateX(90deg);${MAP_COMMENT}"></div>
    <div id="fade" style="opacity:1;transition:opacity 1s;${MAP_COMMENT}"></div>
  </div>
  <link rel="stylesheet" href="styles.css">
  <style>${style}</style>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

const STYLE = `#floor{position:absolute}\n${MAP_COMMENT}`;
const STYLESHEET = `#fade{mask-image:url(mask.png);background:url(bg.png)}\n${MAP_COMMENT}`;

describe("source-map comments in composition CSS", () => {
  let dir: string | undefined;
  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("never sends lint looking for the map a comment names, in inline styles or style blocks", async () => {
    const lookup = vi.spyOn(PreviousMap.prototype, "loadAnnotation");

    const { findings } = await lintHyperframeHtml(page(STYLE));

    expect(lookup).not.toHaveBeenCalled();
    expect(findings.map((f) => f.code)).toContain("three_d_layer_far_larger_than_stage");
  });

  it("never sends project lint looking for the map a linked stylesheet's comment names", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-lint-css-map-"));
    writeFileSync(join(dir, "index.html"), page(STYLE));
    writeFileSync(join(dir, "styles.css"), STYLESHEET);
    const lookup = vi.spyOn(PreviousMap.prototype, "loadAnnotation");

    await lintProject(dir);

    expect(lookup).not.toHaveBeenCalled();
  });
});
