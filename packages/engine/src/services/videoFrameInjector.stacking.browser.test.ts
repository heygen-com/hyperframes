import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { groupIntoLayers } from "../utils/layerCompositor.js";
import { resolveHeadlessShellPath } from "./browserManager.js";
import {
  HDR_LAYER_UNIT_ATTR,
  applyDomLayerMask,
  layerUnitsInside,
  removeDomLayerMask,
} from "./screenshotService.js";
import { queryElementStacking } from "./videoFrameInjector.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

const PAGE = `<html><body style="margin:0">
<div id="host" data-start="0" style="position:absolute;inset:0;width:200px;height:100px">
  <div class="stage" style="position:absolute;inset:0;filter:brightness(0.5)">
    <video id="hdr" data-start="0" style="position:absolute;inset:0;width:200px;height:100px;background:red"></video>
  </div>
  <div id="title" style="position:absolute;top:10px;left:10px;width:50px;height:20px;z-index:10;background:blue"></div>
</div>
</body></html>`;

describe.skipIf(!hasBrowser)("HDR stacking of content inside an HDR element's host", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    page = await browser.newPage();
    await page.setContent(PAGE);
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("puts an untimed overlay that paints above the HDR video in a layer above it", async () => {
    const stacking = await queryElementStacking(page, new Set(["hdr"]));
    const unitId = await page.$eval(
      "#title",
      (el, attr) => el.getAttribute(attr),
      HDR_LAYER_UNIT_ATTR,
    );

    expect(unitId).toBeTruthy();
    expect(groupIntoLayers(stacking).map((l) => (l.type === "hdr" ? "hdr" : l.elementIds))).toEqual(
      [["host"], "hdr", [unitId]],
    );
  });

  it("finds a layer unit inside the elements that hold it, and only there", async () => {
    await queryElementStacking(page, new Set(["hdr"]));
    const unitId = await page.$eval(
      "#title",
      (el, attr) => el.getAttribute(attr),
      HDR_LAYER_UNIT_ATTR,
    );

    expect(await layerUnitsInside(page, ["host"])).toEqual([unitId]);
    expect(await layerUnitsInside(page, ["hdr"])).toEqual([]);
  });

  it("captures the overlay only in its own layer", async () => {
    const stacking = await queryElementStacking(page, new Set(["hdr"]));
    const ids = stacking.map((entry) => entry.id);
    const unitId = ids.find((id) => id !== "host" && id !== "hdr") ?? "";
    const titleVisibility = () =>
      page.$eval("#title", (el) => window.getComputedStyle(el).visibility);

    await applyDomLayerMask(
      page,
      [unitId],
      ids.filter((id) => id !== unitId),
    );
    expect(await titleVisibility()).toBe("visible");
    await removeDomLayerMask(
      page,
      ids.filter((id) => id !== unitId),
    );

    await applyDomLayerMask(
      page,
      ["host"],
      ids.filter((id) => id !== "host"),
    );
    expect(await titleVisibility()).toBe("hidden");
    await removeDomLayerMask(
      page,
      ids.filter((id) => id !== "host"),
    );
  });

  it("puts a timed overlay without an id in a layer above the HDR video", async () => {
    await page.setContent(PAGE.replace('<div id="title"', '<div class="label" data-start="0"'));
    const stacking = await queryElementStacking(page, new Set(["hdr"]));
    const unitId = await page.$eval(
      ".label",
      (el, attr) => el.getAttribute(attr),
      HDR_LAYER_UNIT_ATTR,
    );

    expect(unitId).toBeTruthy();
    expect(groupIntoLayers(stacking).map((l) => (l.type === "hdr" ? "hdr" : l.elementIds))).toEqual(
      [["host"], "hdr", [unitId]],
    );
  });
});
