import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { recordSubTimelineWarning, waitForSubCompositionTimelines } from "./frameCapture.js";
import type { CaptureSession } from "./frameCapture.js";
import { closeTestChrome, launchTestChrome } from "./__fixtures__/loopback.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

// A stand-in for gsap: the isolation only needs timeline() and set() on what it returns.
const FAKE_GSAP = `window.gsap = { timeline: function () { var tl = { total: 0, set: function (a, b, at) { tl.total = at; return tl; } }; return tl; } };`;

function sessionFor(page: Page, errors: string[]): CaptureSession {
  return {
    page,
    pageErrors: errors,
    scriptLoadFailures: [],
    warnings: [],
    subTimelineWaitMemo: {},
  } as unknown as CaptureSession;
}

describe.skipIf(!hasBrowser)("a composition script that throws", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchTestChrome(chromePath);
  });
  afterAll(async () => {
    await closeTestChrome(browser);
  });

  const NESTED = `<script>${FAKE_GSAP}</script>
       <div data-composition-id="root" data-duration="4">
         <div id="chart" data-composition-id="chart" data-duration="4"></div>
         <div id="ok" data-composition-id="ok" data-duration="4"></div>
       </div>
       <script>window.__timelines = { root: {}, ok: {} };</script>
       <script>document.getElementById("missing").appendChild(document.createElement("i"));</script>`;
  const THROWN = ["TypeError: Cannot read properties of null (reading 'appendChild')"];

  it("skips a nested composition with a named warning instead of waiting out the timeout", async () => {
    const page = await browser.newPage();
    await page.setContent(NESTED);
    const session = sessionFor(page, THROWN);
    const started = Date.now();
    await waitForSubCompositionTimelines(session, page, 60_000, { scriptErrorGraceMs: 100 });
    expect(Date.now() - started).toBeLessThan(10_000);

    expect(session.isolatedCompositions).toEqual([{ compositionId: "chart", elementId: "chart" }]);
    const registered = await page.evaluate(
      `(function () { var t = window.__timelines && window.__timelines.chart; return t ? t.total : null; })()`,
    );
    expect(registered).toBe(4);

    recordSubTimelineWarning(session, 60_000);
    expect(session.warnings.map((w) => w.code)).toEqual(["script_error_isolated"]);
    expect(session.warnings[0]?.details?.isolatedElements).toEqual([
      { compositionId: "chart", elementId: "chart" },
    ]);
    await page.close();
  }, 30_000);

  it("keeps the blocking failure when the only nested timeline is the one that threw", async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<script>${FAKE_GSAP}</script>
       <div data-composition-id="root" data-duration="4">
         <div id="chart" data-composition-id="chart" data-duration="4"></div>
       </div>
       <script>window.__timelines = { root: {} };</script>
       <script>document.getElementById("missing").appendChild(document.createElement("i"));</script>`,
    );
    const session = sessionFor(page, THROWN);
    await waitForSubCompositionTimelines(session, page, 60_000, { scriptErrorGraceMs: 100 });
    expect(session.isolatedCompositions).toEqual([]);
    recordSubTimelineWarning(session, 60_000);
    expect(session.warnings.map((w) => w.code)).toEqual(["sub_timeline_script_failure"]);
    await page.close();
  }, 30_000);

  it("keeps the blocking failure when the root composition is the one that failed", async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<script>${FAKE_GSAP}</script>
       <div id="chart" data-composition-id="root" data-duration="4"></div>
       <script>document.getElementById("missing").appendChild(document.createElement("i"));</script>`,
    );
    const session = sessionFor(page, THROWN);
    await waitForSubCompositionTimelines(session, page, 60_000, { scriptErrorGraceMs: 100 });
    expect(session.isolatedCompositions).toEqual([]);
    recordSubTimelineWarning(session, 60_000);
    expect(session.warnings.map((w) => w.code)).toEqual(["sub_timeline_script_failure"]);
    await page.close();
  }, 30_000);

  it("keeps the blocking failure when a script file failed to load", async () => {
    const page = await browser.newPage();
    await page.setContent(NESTED);
    const session = sessionFor(page, []);
    session.scriptLoadFailures.push("http://127.0.0.1:1/missing.js");
    await waitForSubCompositionTimelines(session, page, 60_000, { scriptErrorGraceMs: 100 });
    expect(session.isolatedCompositions).toBeUndefined();
    recordSubTimelineWarning(session, 60_000);
    expect(session.warnings.map((w) => w.code)).toEqual(["sub_timeline_script_failure"]);
    await page.close();
  }, 30_000);

  it("leaves a composition whose timeline registered alone", async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<script>${FAKE_GSAP}</script>
       <div data-composition-id="root" data-duration="2"></div>
       <script>window.__timelines = { root: {} };</script>`,
    );
    const session = sessionFor(page, []);
    await waitForSubCompositionTimelines(session, page, 5_000);
    expect(session.isolatedCompositions).toBeUndefined();
    await page.close();
  }, 30_000);
});
