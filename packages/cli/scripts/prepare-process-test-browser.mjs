import { appendFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { ensureBrowser } from "../src/browser/manager.ts";
import { launchManagedBrowser, closeManagedBrowser } from "../src/browser/launch.ts";

const envFile = process.env.GITHUB_ENV;
if (!envFile) throw new Error("Missing workflow environment file");

const { executablePath } = await ensureBrowser({ preferManagedChrome: true });
const browser = await launchManagedBrowser(puppeteer, {
  executablePath,
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.evaluate(() => 1);
} finally {
  await closeManagedBrowser(browser);
}
appendFileSync(envFile, `HYPERFRAMES_BROWSER_PATH=${executablePath}\n`);
console.log("Pinned process-test browser installed, connected, and stopped.");
