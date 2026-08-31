import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertEvidence } from "./expectations.mjs";

const puppeteerPath = process.env.PUPPETEER_PKG;
if (!puppeteerPath) throw new Error("PUPPETEER_PKG is required");
const puppeteer = (await import(puppeteerPath)).default;

const HERE = dirname(fileURLToPath(import.meta.url));
const MEDIA = resolve(HERE, "../media");
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:4178";
const CHROME_PATH = process.env.CHROME_PATH;
if (!CHROME_PATH) throw new Error("CHROME_PATH is required");

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function installCursor(page) {
  await page.evaluate(() => {
    const dot = document.createElement("div");
    dot.id = "capture-cursor";
    dot.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      "width:18px",
      "height:18px",
      "margin:-9px 0 0 -9px",
      "border-radius:50%",
      "background:rgba(255,255,255,.25)",
      "box-shadow:0 0 0 2px #fff,0 2px 12px #000c",
      "pointer-events:none",
      "z-index:2147483647",
    ].join(";");
    document.documentElement.append(dot);
    addEventListener(
      "pointermove",
      (event) => {
        dot.style.transform = `translate(${event.clientX}px,${event.clientY}px)`;
      },
      true,
    );
    addEventListener("pointerdown", () => (dot.style.background = "#72f1b8"), true);
    addEventListener("pointerup", () => (dot.style.background = "rgba(255,255,255,.25)"), true);
  });
}

export async function captureCase(caseId) {
  mkdirSync(MEDIA, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--window-size=1500,940", "--hide-scrollbars", "--mute-audio"],
    defaultViewport: { width: 1500, height: 940, deviceScaleFactor: 1 },
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${APP_URL}/?case=${caseId}`, { waitUntil: "networkidle2", timeout: 60_000 });
    await page.waitForSelector("#case-detail[data-run-state=idle]");
    await installCursor(page);
    await sleep(700);

    const detail = await page.$("#case-detail");
    if (!detail) throw new Error("case detail is missing");
    const clip = await detail.boundingBox();
    if (!clip) throw new Error("case detail is not visible");
    await page.screenshot({ path: `${MEDIA}/${caseId}.before.png`, clip });
    if (caseId === "valid-round-trip") {
      await page.screenshot({ path: `${MEDIA}/bench.png`, fullPage: true });
    }

    const cast = await page.screencast({ path: `${MEDIA}/${caseId}.webm`, crop: clip });
    const button = await page.$("#run-case");
    if (!button) throw new Error("run button is missing");
    const buttonBox = await button.boundingBox();
    if (!buttonBox) throw new Error("run button is not visible");
    await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2, {
      steps: 24,
    });
    await sleep(450);
    await page.mouse.down();
    await sleep(180);
    await page.mouse.up();
    await page.waitForSelector("#case-detail[data-run-state=done]", { timeout: 15_000 });
    await sleep(900);
    await page.screenshot({ path: `${MEDIA}/${caseId}.after.png`, clip });
    await cast.stop();

    const response = await fetch(`${APP_URL}/evidence/${caseId}`);
    if (!response.ok) throw new Error(`${caseId} evidence read failed: ${response.status}`);
    const evidence = await response.json();
    if (evidence.caseId !== caseId) throw new Error(`${caseId} evidence has the wrong case id`);
    assertEvidence(caseId, evidence);
    if (errors.length > 0) throw new Error(`${caseId} page errors: ${errors.join("; ")}`);
    console.log(
      JSON.stringify({
        caseId,
        result: evidence.result,
        materializerCalls: evidence.materializerCalls,
        independentlyVerified: true,
      }),
    );
  } finally {
    await browser.close();
  }
}
