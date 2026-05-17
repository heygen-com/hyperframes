/**
 * Read SwiftShader vendor/renderer via a 1×1 WebGL canvas + the
 * `WEBGL_debug_renderer_info` extension. Used as the `readInfo` override
 * for {@link assertSwiftShader} when the worker is running on
 * `chrome-headless-shell` — that build serves `chrome://gpu` as an empty
 * document so the default `chrome://gpu`-based info reader trips
 * `net::ERR_FAILED` even when the GL backend is in fact SwiftShader.
 *
 * The canvas-based probe runs against whatever page the caller hands in
 * (we use a fresh `about:blank` so it doesn't depend on the composition
 * URL being navigated yet). The renderer string returned matches the
 * format `assertSwiftShader` expects (substring match against
 * `"swiftshader"`).
 */

import type { Page } from "puppeteer-core";

export async function readWebGlVendorInfoFromCanvas(
  page: Page,
): Promise<{ vendor: string; renderer: string }> {
  await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 30_000 });
  return page.evaluate((): { vendor: string; renderer: string } => {
    try {
      const canvas = document.createElement("canvas");
      const gl =
        (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
        (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
      if (!gl) {
        return { vendor: "", renderer: "" };
      }
      const ext = gl.getExtension("WEBGL_debug_renderer_info") as {
        UNMASKED_VENDOR_WEBGL: number;
        UNMASKED_RENDERER_WEBGL: number;
      } | null;
      if (!ext) {
        return {
          vendor: String(gl.getParameter(gl.VENDOR) ?? ""),
          renderer: String(gl.getParameter(gl.RENDERER) ?? ""),
        };
      }
      // Older Chrome builds expose the unmasked strings under the literal
      // numeric constants 0x9245 / 0x9246. The extension surface above is
      // identical across builds — read through it.
      return {
        vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? ""),
        renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? ""),
      };
    } catch {
      return { vendor: "", renderer: "" };
    }
  });
}
