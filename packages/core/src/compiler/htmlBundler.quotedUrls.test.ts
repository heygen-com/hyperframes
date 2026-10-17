// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler.js";

describe("static bundles with quoted CSS resource names", () => {
  it.each(["cover(1).svg", "author's.svg", "cover.svg"])(
    "embeds the exact owned bytes for %s",
    async (filename) => {
      const root = mkdtempSync(join(tmpdir(), "hf-quoted-css-"));
      try {
        mkdirSync(join(root, "scenes"));
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>' + filename + "</text></svg>";
        writeFileSync(join(root, filename), svg);
        writeFileSync(
          join(root, "index.html"),
          '<!doctype html><html><head></head><body><div data-composition-id="root" data-width="320" data-height="180" data-duration="1"><div data-composition-id="scene" data-composition-src="scenes/scene.html"></div></div><script>window.__timelines={root:{}};</script></body></html>',
        );
        writeFileSync(
          join(root, "scenes/scene.html"),
          '<!doctype html><html><head><style>.card{background-image:url("../' +
            filename +
            '")}</style></head><body><div data-composition-id="scene" data-width="320" data-height="180" data-duration="1"><div class="card" style="background-image:url(&quot;../' +
            filename +
            '&quot;)">owned</div></div></body></html>',
        );
        const output = await bundleToSingleHtml(root, { runtime: "placeholder" });
        const { document } = parseHTML(output);
        const dataUrl = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
        const css = [...document.querySelectorAll("style")]
          .map((style) => style.textContent)
          .join("\n");
        expect(css).toContain(dataUrl);
        expect(document.querySelector(".card")?.getAttribute("style")).toContain(dataUrl);
        expect(css).not.toContain("../" + filename);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
