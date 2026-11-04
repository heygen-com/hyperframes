import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openSettledCompositionPage } from "../capture/captureCompositionFrame.js";
import { serveStaticProjectHtml } from "./staticProjectServer.js";

// Past Chrome's 1024-byte prescan and outside <head>, a <meta charset> is ignored; the page must still be UTF-8.
const HTML = `<!doctype html><html><head><style>p{margin:0}/*${"x".repeat(2048)}*/</style></head><body>
<meta charset="UTF-8" />
<div data-composition-id="main" data-width="320" data-height="180" data-duration="1">
<p id="raw">Café è ù ✓</p></div>
<script>window.__renderReady = true;</script></body></html>`;

it("shows accented text as written when the page's meta charset is not in its head", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-charset-"));
  writeFileSync(join(projectDir, "index.html"), HTML);
  const server = await serveStaticProjectHtml(projectDir, HTML);
  try {
    const { browser, page } = await openSettledCompositionPage(HTML, server.url, {
      renderReadyTimeoutMs: 5_000,
      renderReadyWarningSuffix: "test",
      browserGpuMode: "software",
    });
    try {
      expect(
        await page.evaluate(() => ({
          charset: document.characterSet,
          raw: document.getElementById("raw")?.textContent,
        })),
      ).toEqual({ charset: "UTF-8", raw: "Café è ù ✓" });
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
    rmSync(projectDir, { recursive: true, force: true });
  }
}, 90_000);
