import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import type { Page, ScreenshotOptions } from "puppeteer-core";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { captureFullPagePlate, MAX_PLATE_HEIGHT_PX } from "./screenshotCapture.js";

function fixture(css: string, inline = "", height = 640) {
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
  window.document.head.innerHTML = `<style>.nav{position:fixed}${css}</style>`;
  window.document.body.innerHTML = `<nav class="nav" style="${inline}"></nav>`;
  const nav = window.document.querySelector("nav");
  if (!nav) throw new Error("Missing fixture navigation");
  const state = () => ({
    computed: window.getComputedStyle(nav).position,
    value: nav.style.getPropertyValue("position"),
    priority: nav.style.getPropertyPriority("position"),
  });
  const original = state();
  const evaluate: Page["evaluate"] = async (script, ...args) => {
    if (String(script).includes("scrollHeight")) return height;
    return runInNewContext(
      typeof script === "string" ? script : `(${script.toString()})(...args)`,
      {
        document: window.document,
        getComputedStyle: window.getComputedStyle.bind(window),
        args,
      },
    );
  };
  const buffer = Buffer.alloc(24);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(height, 20);
  let captured: ReturnType<typeof state> | undefined;
  const screenshot = vi.fn(async (_options?: Readonly<ScreenshotOptions>) => {
    captured = state();
    return buffer;
  });
  function takeScreenshot(
    options: Readonly<ScreenshotOptions> & { encoding: "base64" },
  ): Promise<string>;
  function takeScreenshot(options?: Readonly<ScreenshotOptions>): Promise<Uint8Array>;
  async function takeScreenshot(
    options?: Readonly<ScreenshotOptions>,
  ): Promise<string | Uint8Array> {
    const bytes = await screenshot(options);
    return options?.encoding === "base64" ? bytes.toString("base64") : bytes;
  }
  const page = { evaluate, screenshot: takeScreenshot };
  const dir = mkdtempSync(join(tmpdir(), "hf-plate-priority-"));
  onTestFinished(async () => {
    await window.happyDOM.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    page,
    dir,
    nav,
    screenshot,
    captured: () => captured,
    expectRestored: () => {
      expect(state()).toEqual(original);
      expect(
        Array.from(nav.attributes).filter((attribute) =>
          attribute.name.startsWith("data-hf-plate"),
        ),
      ).toEqual([]);
    },
  };
}

describe("full-page capture CSS priority", () => {
  it.each([
    ["important fixed stylesheet", ".nav{position:fixed!important}", ""],
    ["important sticky stylesheet", ".nav{position:sticky!important}", ""],
    [
      "important inline fixed position",
      ".nav{position:relative!important}",
      "position:fixed!important",
    ],
    [
      "important inline sticky position",
      ".nav{position:relative!important}",
      "position:sticky!important",
    ],
  ])("neutralizes %s and restores its original declaration", async (_name, css, inline) => {
    const f = fixture(css, inline);

    expect(await captureFullPagePlate(f.page, f.dir)).toEqual({
      kind: "captured",
      file: "screenshots/full-page.png",
    });

    expect(f.captured()?.computed).toBe("static");
    f.expectRestored();
  });

  it("restores priority when the screenshot fails", async () => {
    const f = fixture(".nav{position:relative!important}", "position:fixed!important");
    f.screenshot.mockRejectedValue(new Error("Screenshot failed"));

    await expect(captureFullPagePlate(f.page, f.dir)).rejects.toThrow("Screenshot failed");

    f.expectRestored();
  });

  it.each([
    ["height-limit", MAX_PLATE_HEIGHT_PX + 1, 1000],
    ["budget-exhausted", 640, 0],
  ])("restores priority when the plate is omitted for %s", async (reason, height, remainingMs) => {
    const f = fixture(".nav{position:relative!important}", "position:fixed!important", height);

    expect(await captureFullPagePlate(f.page, f.dir, { remainingMs: () => remainingMs })).toEqual({
      kind: "omitted",
      reason,
    });

    expect(f.screenshot).not.toHaveBeenCalled();
    f.expectRestored();
  });

  it("restores an ordinary inline position and leaves static elements untouched", async () => {
    const f = fixture("", "position:sticky");
    const staticElement = f.nav.ownerDocument.createElement("aside");
    staticElement.style.position = "relative";
    f.nav.after(staticElement);

    await captureFullPagePlate(f.page, f.dir);

    expect(f.captured()?.computed).toBe("static");
    f.expectRestored();
    expect(staticElement.style.position).toBe("relative");
    expect(staticElement.attributes.length).toBe(1);
  });
});
