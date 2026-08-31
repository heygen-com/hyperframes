import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const puppeteerPath = process.env.PUPPETEER_PKG;
if (!puppeteerPath) throw new Error("PUPPETEER_PKG is required");
const puppeteer = (await import(puppeteerPath)).default;

const chromePath = process.env.CHROME_PATH;
if (!chromePath) throw new Error("CHROME_PATH is required");

const here = dirname(fileURLToPath(import.meta.url));
const showcase = resolve(here, "../index.html");
const viewportWidth = Number(process.env.VIEWPORT_WIDTH ?? 1500);
const viewportHeight = Number(process.env.VIEWPORT_HEIGHT ?? 1000);
const screenshotName = process.env.SCREENSHOT_NAME ?? "showcase.png";
const screenshot = resolve(here, `../media/${screenshotName}`);
mkdirSync(dirname(screenshot), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    `--window-size=${viewportWidth},${viewportHeight}`,
    "--hide-scrollbars",
    "--mute-audio",
  ],
  defaultViewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(showcase).href, { waitUntil: "networkidle0" });
  await page.waitForFunction(
    () => [...document.querySelectorAll("video")].every((video) => video.readyState >= 2),
    { timeout: 30_000 },
  );
  const status = await page.evaluate(() => ({
    layout: {
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    },
    videos: [...document.querySelectorAll("video")].map((video) => ({
      source: new URL(video.currentSrc).pathname.split("/").at(-1),
      readyState: video.readyState,
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    })),
    images: [...document.images].map((image) => ({
      source: new URL(image.currentSrc).pathname.split("/").at(-1),
      complete: image.complete,
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
  }));
  if (errors.length > 0) throw new Error(`showcase errors: ${errors.join("; ")}`);
  if (status.layout.horizontalOverflow) throw new Error("showcase has horizontal overflow");
  if (status.images.some((image) => !image.complete || image.width === 0)) {
    throw new Error("a showcase image did not load");
  }
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify(status));
} finally {
  await browser.close();
}
