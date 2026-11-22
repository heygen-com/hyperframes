#!/usr/bin/env node
// Color-graded videos keep their animation in the preview: a red-to-blue opacity dissolve (2-4 s) and a
// green clip-path wipe from the left (4-6 s). Grading once froze the dissolve, and its hide once blacked it out.
// A click on a graded clip still picks it.
import { mkdirSync, writeFileSync } from "node:fs";
import { launchStudioChrome } from "./chrome-executable.mjs";

const STUDIO_URL = process.env.STUDIO_URL;
const OUT_DIR = process.env.OUT_DIR;

if (!STUDIO_URL) {
  console.error("STUDIO_URL is required and must point at the graded-video-transitions fixture");
  process.exit(2);
}
if (OUT_DIR) mkdirSync(OUT_DIR, { recursive: true });

// Share of red in red + blue at the dissolve's quarter points, and which colour leads either side of the wipe.
const DISSOLVE = [
  { time: 2.5, red: 0.75 },
  { time: 3, red: 0.5 },
  { time: 3.5, red: 0.25 },
];
const WIPE = { time: 5, left: "green", right: "blue" };
const TOLERANCE = 0.12;

const { browser } = await launchStudioChrome();
const failures = [];
const evidence = {};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-label="Play"]:not([disabled])', { timeout: 60_000 });
  const handle = await page.waitForFunction(
    () => document.querySelector("hyperframes-player")?.shadowRoot?.querySelector("iframe"),
    { timeout: 60_000 },
  );
  const iframe = handle.asElement();
  const frame = await iframe.contentFrame();
  await frame.waitForFunction(() => window.__playerReady, { timeout: 60_000 });

  /** RGB at fractions of the film's width and height, read from a screenshot of the preview at `time`. */
  const sample = async (name, time, points) => {
    await frame.evaluate((t) => window.__player.seek(t, { settled: true }), time);
    await frame.evaluate(() => window.__hfWaitForSeekCompletion?.());
    await frame.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const film = await frame.evaluate(() => {
      const r = document.getElementById("film").getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const png = await iframe.screenshot({ encoding: "base64" });
    if (OUT_DIR) writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(png, "base64"));
    const box = await iframe.boundingBox();
    const scale = box.width / (await frame.evaluate(() => window.innerWidth));
    return page.evaluate(
      async (data, film, scale, points) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = new OffscreenCanvas(img.width, img.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return points.map(([fx, fy]) => {
          const x = Math.round((film.x + film.width * fx) * scale);
          const y = Math.round((film.y + film.height * fy) * scale);
          const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
          return { r, g, b };
        });
      },
      png,
      film,
      scale,
      points,
    );
  };
  const dark = ({ r, g, b }) => Math.max(r, g, b) < 40;
  const leads = ({ r, g, b }) => (g > r && g > b ? "green" : b > r ? "blue" : "red");

  for (const { time, red } of DISSOLVE) {
    const [centre] = await sample(`dissolve-${time}`, time, [[0.5, 0.5]]);
    const share = centre.r / Math.max(1, centre.r + centre.b);
    evidence[`dissolve-${time}`] = { ...centre, share: Number(share.toFixed(3)) };
    if (dark(centre)) failures.push(`dissolve at ${time} s: black (${JSON.stringify(centre)})`);
    else if (Math.abs(share - red) > TOLERANCE)
      failures.push(`dissolve at ${time} s: red share ${share.toFixed(2)}, expected ${red}`);
  }

  // A graded clip stays under the pointer, so a click in the preview still picks it.
  await frame.evaluate(() => window.__player.seek(1, { settled: true }));
  const picked = await frame.evaluate(() => {
    const r = document.getElementById("film").getBoundingClientRect();
    return document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).map((el) => el.id);
  });
  evidence.pickAt1 = picked;
  if (!picked.includes("a"))
    failures.push(`at 1 s the graded clip is not under the pointer: ${picked}`);

  const [left, right] = await sample("wipe-5", WIPE.time, [
    [0.25, 0.5],
    [0.75, 0.5],
  ]);
  evidence.wipe = { left, right };
  for (const [side, pixel, colour] of [
    ["left", left, WIPE.left],
    ["right", right, WIPE.right],
  ]) {
    if (dark(pixel)) failures.push(`wipe at ${WIPE.time} s, ${side}: black`);
    else if (leads(pixel) !== colour)
      failures.push(`wipe at ${WIPE.time} s, ${side}: ${leads(pixel)} leads, expected ${colour}`);
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ evidence, failures }, null, 2));
if (failures.length > 0) process.exit(1);
