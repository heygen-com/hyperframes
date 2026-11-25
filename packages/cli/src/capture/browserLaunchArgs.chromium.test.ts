import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { describe, expect, it } from "vitest";
import { findSystemBrowser } from "../browser/manager.js";
import { captureBrowserArgs } from "./browserLaunchArgs.js";

const configured = process.env.HYPERFRAMES_BROWSER_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH;
const executablePath =
  configured && existsSync(configured) ? configured : findSystemBrowser()?.executablePath;
const runsChromium =
  !!executablePath &&
  (process.platform !== "win32" || process.env.HYPERFRAMES_BROWSER_TESTS === "1");

describe.skipIf(!runsChromium)("capture's first launch", () => {
  // fails without the fix: SwiftShader also composited every animated layer, so an ordinary CSS-animated page
  // used both CPUs of a 2-CPU host and ran capture out of budget (#8527).
  it("composites in software while WebGL still draws and reads back", async () => {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: captureBrowserArgs(false, 200, 200, false),
    });
    try {
      const info = (await (
        await browser.target().createCDPSession()
      ).send("SystemInfo.getInfo")) as {
        gpu: { featureStatus: Record<string, string> };
      };
      expect(info.gpu.featureStatus.gpu_compositing).toMatch(/^disabled/);

      const page = await browser.newPage();
      await page.setContent('<canvas id="c" width="8" height="8"></canvas>');
      const pixel = await page.evaluate(() => {
        const canvas = document.getElementById("c") as HTMLCanvasElement;
        const gl = canvas.getContext("webgl");
        if (!gl) return null;
        gl.clearColor(1, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const out = new Uint8Array(4);
        gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return [...out];
      });
      expect(pixel).toEqual([255, 0, 0, 255]);
    } finally {
      await browser.close();
    }
  }, 30_000);
});
