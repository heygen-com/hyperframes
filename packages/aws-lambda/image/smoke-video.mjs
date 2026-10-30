// A handler mounted into the video image and invoked through its own Lambda bootstrap, which sets
// AWS_EXECUTION_ENV as Lambda does: the bundled ffmpeg answers and arm64 Chrome renders, launched as
// src/chromium.ts launches it.
import { execFileSync } from "node:child_process";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const handler = async () => {
  const ffmpeg = execFileSync("/var/task/bin/ffmpeg", ["-hide_banner", "-version"], {
    encoding: "utf-8",
  }).split("\n")[0];
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: chromium.args,
  });
  try {
    const page = await browser.newPage();
    await page.setContent("<div style='width:64px;height:64px;background:#0a0'></div>");
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } });
    return {
      executionEnv: process.env.AWS_EXECUTION_ENV,
      arch: process.arch,
      ffmpeg,
      chrome: await browser.version(),
      screenshotBytes: shot.length,
    };
  } finally {
    await browser.close();
  }
};
