// A handler mounted into the video image and invoked through its own Lambda bootstrap, which sets
// AWS_EXECUTION_ENV as Lambda does: the bundled ffmpeg answers and the image's chrome-headless-shell
// renders, found where src/chromium.ts finds it and launched with the engine's Lambda flags.
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

export const handler = async () => {
  const ffmpeg = execFileSync("/var/task/bin/ffmpeg", ["-hide_banner", "-version"], {
    encoding: "utf-8",
  }).split("\n")[0];
  const browser = await puppeteer.launch({
    executablePath: process.env.HYPERFRAMES_LAMBDA_CHROME_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--no-zygote", "--disable-dev-shm-usage"],
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
