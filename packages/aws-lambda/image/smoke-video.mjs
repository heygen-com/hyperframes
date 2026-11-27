// A handler mounted into a Lambda Node 22 image and invoked through its own Lambda bootstrap, which sets
// AWS_EXECUTION_ENV as Lambda does. In the arm64 video image it runs the image's chrome-headless-shell, found
// where src/chromium.ts finds it; in the x86 base over the unzipped handler ZIP, @sparticuz/chromium.
// It reports the platform fonts each line of a mixed-script page renders with, so the two can be compared.
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const LINES = {
  latin: "sans-serif|Quick brown fox ÀÉÎÕÜ ß œ",
  serif: "serif|Quick brown fox ÀÉÎÕÜ ß œ",
  mono: "monospace|Quick brown fox 0123456789",
  greekCyrillic: "sans-serif|Ελληνικά Кириллица",
  cjk: "sans-serif|漢字 かな カナ 한국어",
  arabic: "sans-serif|العربية",
  emoji: "sans-serif|😀 🎬 ✅",
};

const textPage = Object.entries(LINES)
  .map(([id, line]) => {
    const [family, text] = line.split("|");
    return `<p id="${id}" style="font:24px ${family};margin:4px">${text}</p>`;
  })
  .join("");

async function launch() {
  if (process.env.HYPERFRAMES_LAMBDA_CHROME_PATH) {
    return puppeteer.launch({
      executablePath: process.env.HYPERFRAMES_LAMBDA_CHROME_PATH,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--no-zygote", "--disable-dev-shm-usage"],
    });
  }
  const { default: chromium } = await import("@sparticuz/chromium");
  return puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args });
}

async function platformFonts(page) {
  const cdp = await page.createCDPSession();
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const fonts = {};
  for (const id of Object.keys(LINES)) {
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: `#${id}`,
    });
    const { fonts: used } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    fonts[id] = used.map((font) => `${font.familyName}:${font.glyphCount}`).sort();
  }
  return fonts;
}

export const handler = async () => {
  const ffmpeg = execFileSync("/var/task/bin/ffmpeg", ["-hide_banner", "-version"], {
    encoding: "utf-8",
  }).split("\n")[0];
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<div style='width:64px;height:64px;background:#0a0'></div>");
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } });
    await page.setViewport({ width: 640, height: 360 });
    await page.setContent(textPage);
    return {
      executionEnv: process.env.AWS_EXECUTION_ENV,
      arch: process.arch,
      ffmpeg,
      chrome: await browser.version(),
      screenshotBytes: shot.length,
      fonts: await platformFonts(page),
      textPng: Buffer.from(await page.screenshot()).toString("base64"),
    };
  } finally {
    await browser.close();
  }
};
