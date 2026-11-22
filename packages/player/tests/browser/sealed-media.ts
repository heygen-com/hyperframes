import assert from "node:assert/strict";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

const server = startServer();
const browser = await launchBrowser();

type VideoState = { crossOrigin: string | null; readyState: number; error: number | null };

/** A sealed player playing the 10-video film from a host with or without CORS headers. */
async function play(cors: boolean) {
  const page = await browser.newPage();
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warn") warnings.push(message.text());
  });
  await page.goto(
    `${server.origin}/host.html?fixture=10-video-grid&sealed=1${cors ? "" : "&cors=0"}`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await page.waitForFunction(() => window.__playerReady || window.__playerError, {
    timeout: 60_000,
  });
  await page.evaluate(() =>
    (document.getElementById("player") as HTMLElement & { play: () => void }).play(),
  );
  const frame = page.frames().find((candidate) => candidate.url().includes("/10-video-grid/"));
  assert.ok(frame, "the film's frame must load");
  await frame.waitForFunction(
    () => [...document.querySelectorAll("video")].every((v) => v.readyState >= 2 || v.error),
    { timeout: 30_000 },
  );
  const videos: VideoState[] = await frame.evaluate(() =>
    [...document.querySelectorAll("video")].map((v) => ({
      crossOrigin: v.getAttribute("crossorigin"),
      readyState: v.readyState,
      error: v.error?.code ?? null,
    })),
  );
  const pixels = await frame.evaluate(() => {
    const video = document.querySelector("video")!;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.drawImage(video, 0, 0, 1, 1);
    try {
      context.getImageData(0, 0, 1, 1);
      return "readable";
    } catch {
      return "refused";
    }
  });
  await page.close();
  return { videos, pixels, warnings };
}

/** A sealed player loaded by src whose frame may not start sound: the files it copies into the page. */
async function sealedCopies(): Promise<string[]> {
  const strict = await launchBrowser({ autoplay: "gesture" });
  try {
    const page = await strict.newPage();
    await page.goto(`${server.origin}/host.html?fixture=sealed-audio&sealed=1`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(() => window.__playerReady || window.__playerError, {
      timeout: 60_000,
    });
    await page.evaluate(() =>
      (document.getElementById("player") as HTMLElement & { play: () => void }).play(),
    );
    type Copies = { _audioOwner: string; _parentMedia: { el: HTMLMediaElement }[] };
    await page.waitForFunction(
      () => (document.getElementById("player") as unknown as Copies)._audioOwner === "parent",
      { timeout: 30_000 },
    );
    return await page.evaluate(() =>
      (document.getElementById("player") as unknown as Copies)._parentMedia.map((m) => m.el.src),
    );
  } finally {
    await strict.close();
  }
}

try {
  assert.deepEqual(
    await sealedCopies(),
    [`${server.origin}/fixtures/sealed-audio/tone.m4a`],
    "a sealed player loaded by src copies its film's sound into the page when the frame may not start it",
  );

  const plain = await play(false);
  assert.equal(
    plain.videos.filter((v) => v.readyState >= 2 && v.error === null).length,
    10,
    `a sealed film on a host without CORS must still play all 10 videos: ${JSON.stringify(plain.videos)}`,
  );
  assert.ok(
    plain.videos.every((v) => v.crossOrigin === null),
    "a video whose CORS load failed plays without crossorigin",
  );
  const named = plain.warnings.filter((w) => w.includes("10-video-grid/sample.mp4"));
  assert.equal(named.length, 10, `the fallback is said once per video: ${JSON.stringify(named)}`);

  const shared = await play(true);
  assert.equal(
    shared.videos.filter((v) => v.crossOrigin === "anonymous" && v.readyState >= 2).length,
    10,
    `a sealed film on a CORS host keeps crossorigin: ${JSON.stringify(shared.videos)}`,
  );
  assert.equal(shared.pixels, "readable", "a CORS-loaded video's pixels can be read");
  assert.deepEqual(
    shared.warnings.filter((w) => w.includes("sample.mp4")),
    [],
  );
  console.log(
    "[sealed-media] a host without CORS plays; a CORS host keeps pixel access; a refused frame's sound plays from a copy",
  );
} finally {
  await browser.close();
  await server.stop();
}
