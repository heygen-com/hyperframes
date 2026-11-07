import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser } from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_OPEN_MEDIA_RANGE_BYTES } from "@hyperframes/studio-server";
import { serveStaticProjectHtml, type StaticProjectServer } from "./staticProjectServer.js";

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
const ffmpegPresent = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// Chromium opens at most six HTTP/1.1 connections to a host, and a <video> keeps its response open once its buffer
// is full, so eight of them on one file, each served to EOF, would pin every connection and leave the next request
// to the host unanswered.
const CLIPS = 8;
const PINNED = 6;
const ANSWER_WITHIN_MS = 10_000;

describe.runIf(executablePath && ffmpegPresent)("media ranges in Chromium", () => {
  let browser: Browser;
  let dir: string;
  let server: StaticProjectServer;

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox"] });
    dir = mkdtempSync(join(tmpdir(), "media-range-chromium-"));
    // Long and noisy, so about 45 MB of real media: a clip whose whole duration fits the buffer is read to its end
    // and closed, which pins nothing.
    const clip = join(dir, "clip.mp4");
    execFileSync("ffmpeg", [
      ...["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=640x360:d=120:r=25"],
      ...["-vf", "geq=random(1)*255:128:128", "-pix_fmt", "yuv420p"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-b:v", "3M", "-movflags", "+faststart"],
      ...["-y", clip],
    ]);
    expect(statSync(clip).size, "longer than one bounded piece per clip").toBeGreaterThan(
      CLIPS * MAX_OPEN_MEDIA_RANGE_BYTES,
    );
    writeFileSync(join(dir, "probe.txt"), "ok");
    // Chromium shares one loader between elements with the same URL, so each clip gets its own query string.
    const clips = Array.from(
      { length: CLIPS },
      (_, index) => `<video src="clip.mp4?clip=${index}" preload="auto" muted></video>`,
    ).join("");
    server = await serveStaticProjectHtml(dir, `<!doctype html><body>${clips}</body>`);
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("answers a new request to the host while eight clips of one file are buffering", async () => {
    expect(server.port, "a real socket, so the browser's connection limit applies").toBeGreaterThan(
      0,
    );
    const page = await browser.newPage();
    try {
      await page.goto(server.url, { waitUntil: "load" });
      await page.waitForFunction(
        (pinned) =>
          [...document.querySelectorAll("video")].filter((video) => video.readyState >= 3).length >=
          pinned,
        { timeout: 60_000 },
        PINNED,
      );
      const outcome = await page.evaluate(
        (limit) =>
          Promise.race([
            fetch(`/probe.txt?${Date.now()}`).then((response) => response.status),
            new Promise<string>((resolve) => setTimeout(() => resolve("unanswered"), limit)),
          ]),
        ANSWER_WITHIN_MS,
      );
      expect(outcome, "the host still answers while clips buffer").toBe(200);
    } finally {
      await page.close();
    }
  }, 120_000);
});
