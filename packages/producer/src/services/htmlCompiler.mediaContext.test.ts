import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileForRender } from "./htmlCompiler.js";

it.each([true, false])(
  "resolves media context once before fonts, authored head=%s",
  async (authoredHead) => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-compile-media-context-"));
    try {
      const htmlPath = join(projectDir, "index.html");
      writeFileSync(
        htmlPath,
        `<html>${authoredHead ? "<head></head>" : ""}<body>
      <main data-composition-id="root" data-composition-src="scene.html" data-start="0"></main>
    </body></html>`,
      );
      writeFileSync(
        join(projectDir, "scene.html"),
        `<html><head><style>
      @media (resolution: 2dppx) { p { font-family: Inter; } }
    </style></head><body>
      <section data-composition-id="root" data-width="640" data-height="360" data-duration="1">
        <p>Assembled title</p>
      </section>
    </body></html>`,
      );
      const decisions: Array<{ width: number; height: number }> = [];
      const compiled = await compileForRender(projectDir, htmlPath, projectDir, {
        allowSystemFontCapture: false,
        resolveMediaContext: (viewport) => {
          decisions.push(viewport);
          return { deviceScaleFactor: 2 };
        },
      });
      expect(decisions).toEqual([{ width: 640, height: 360 }]);
      expect({ width: compiled.width, height: compiled.height }).toEqual({
        width: 640,
        height: 360,
      });
      expect(compiled.mediaContext).toEqual({
        viewport: { width: 640, height: 360 },
        deviceScaleFactor: 2,
      });
      expect(compiled.html).toContain('data-hyperframes-deterministic-fonts="true"');
      expect(compiled.html).toContain('font-family: "Inter";');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  },
);

it("uses the render DPR when normalizing conditional variable fallbacks", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-normalize-media-context-"));
  try {
    const htmlPath = join(projectDir, "index.html");
    writeFileSync(
      htmlPath,
      `<html><head><style>
      @media (resolution: 1dppx) { :root { --font: Montserrat; } }
      p { font-family: var(--font, serif); }
    </style></head><body><main data-composition-id="root" data-width="640" data-height="360" data-duration="1"><p>Title</p></main></body></html>`,
    );
    const compiled = await compileForRender(projectDir, htmlPath, projectDir, {
      allowSystemFontCapture: false,
      resolveMediaContext: () => ({ deviceScaleFactor: 2 }),
    });
    expect(compiled.mediaContext.deviceScaleFactor).toBe(2);
    expect(compiled.html).toContain('data-hyperframes-deterministic-fonts="true"');
    expect(compiled.html).toContain('font-family: "Inter";');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
