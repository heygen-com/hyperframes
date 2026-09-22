// Loads a page in real Chrome and reports every failed request or thrown
// error, catching a script-fetched asset a static markup scan can't see.

import puppeteer, { type Browser } from "puppeteer";
import { injectScriptsAtHeadStart } from "@hyperframes/core/compiler";
import { getVerifiedHyperframeRuntimeSource } from "./services/hyperframeRuntimeLoader.js";

export interface PageCheckResult {
  failures: string[];
}

export async function launchVerifyBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

export async function checkPageLoads(
  browser: Browser,
  originUrl: string,
  html: string,
  settleMs = 2000,
): Promise<PageCheckResult> {
  const page = await browser.newPage();
  const failures: string[] = [];
  page.on("response", (res) => {
    if (res.status() >= 400)
      failures.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });
  page.on("requestfailed", (req) => {
    failures.push(`request failed: ${req.url()} (${req.failure()?.errorText ?? "unknown"})`);
  });
  page.on("pageerror", (err) => {
    failures.push(`pageerror: ${err instanceof Error ? err.message : String(err)}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") failures.push(`console.error: ${msg.text()}`);
  });
  try {
    await page.goto(originUrl, { waitUntil: "domcontentloaded" });
    // Every real host (fileServer.ts's preHeadScripts) injects the runtime
    // into <head> before any composition script runs, so window.__timelines
    // exists by the time it does. Without this, every payload's own script
    // throws on first paint and the check reports it as broken.
    const htmlWithRuntime = injectScriptsAtHeadStart(html, [getVerifiedHyperframeRuntimeSource()]);
    await page.setContent(htmlWithRuntime, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, settleMs));
  } finally {
    await page.close();
  }
  return { failures };
}
