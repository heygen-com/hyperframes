import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeManagedBrowser, launchManagedBrowser } from "../browser/launch.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";

interface AuditIssue {
  code: string;
  severity: string;
  selector: string;
  message: string;
  coveredFraction?: number;
}

declare global {
  interface Window {
    __hyperframesLayoutAudit(options: { time: number; tolerance: number }): AuditIssue[];
  }
}

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const script = readFileSync(new URL("./layout-audit.browser.js", import.meta.url), "utf8");

// 320x180 clips shown at 640x360. The cutout's subject fills the left half until 0.5s and the
// right half after it, the horizon's fills the bottom half, the strip's is opaque only at source
// x 76-104 (page x 152-208), and the opaque clip has no alpha plane.
const CLIPS: Record<string, string[]> = {
  "cutout.webm": [
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=320x180:d=1:r=10,format=rgba,geq=r='255':g='0':b='0':a='if(lt(T,0.5),if(lt(X,W/2),255,0),if(gte(X,W/2),255,0))'",
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-auto-alt-ref",
    "0",
  ],
  "horizon.webm": [
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=320x180:d=1:r=10,format=rgba,geq=r='255':g='0':b='0':a='if(gte(Y,H/2),255,0)'",
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-auto-alt-ref",
    "0",
  ],
  "strip.webm": [
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=320x180:d=1:r=10,format=rgba,geq=r='255':g='0':b='0':a='if(between(X,76,104),255,0)'",
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-auto-alt-ref",
    "0",
  ],
  "opaque.webm": [
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:d=1:r=10",
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuv420p",
  ],
};

const word = (id: string, left: number, text: string, extra = "") =>
  `<span id="${id}" ${extra} style="position:absolute;left:${left}px;top:150px;transform:translateX(-50%);margin:0;font:700 48px/1 Arial;color:#fff;white-space:nowrap">${text}</span>`;

function page(video: string, words: string): string {
  return `<!doctype html><body style="margin:0">
    <div data-composition-id="main" data-width="640" data-height="360" style="position:relative;width:640px;height:360px;background:#111">
      <div style="position:absolute;inset:0;z-index:1">${words}</div>
      ${video}
    </div></body>`;
}

const videoTag = (src: string, extra = "", style = "") =>
  `<video id="clip" src="/${src}" muted playsinline ${extra} style="position:absolute;left:0;top:0;width:640px;height:360px;z-index:2;${style}"></video>`;

// A ~590px caption whose word "gh" is moved onto the strip's centre (page x 180). The coarse probe
// columns at 20% and 35% of the line then fall either side of the strip, never on it.
const STRIP_CAPTION = `<span id="line" style="position:absolute;left:0;top:150px;margin:0;font:24px/1 monospace;color:#fff;white-space:nowrap">abcdefghi gh ij kl mn op qr st uv wx yz ab cd</span>
  <script>
    const line = document.getElementById("line");
    const text = line.firstChild;
    const range = document.createRange();
    range.setStart(text, 10);
    range.setEnd(text, 12);
    const word = range.getBoundingClientRect();
    line.style.left = 180 - (word.left + word.width / 2) + "px";
  </script>`;

// Chromium only seeks a media resource its server serves by byte range.
function serveByteRange(body: Buffer, rangeHeader: string | undefined, response: ServerResponse) {
  const range = /bytes=(\d+)-(\d*)/.exec(rangeHeader ?? "");
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : body.length - 1;
  response.writeHead(range ? 206 : 200, {
    "content-type": "video/webm",
    "accept-ranges": "bytes",
    "content-length": end - start + 1,
    ...(range ? { "content-range": `bytes ${start}-${end}/${body.length}` } : {}),
  });
  response.end(body.subarray(start, end + 1));
}

describe.runIf(executablePath && hasFfmpeg)("text_occluded behind a <video> in Chromium", () => {
  let browser: Browser;
  let server: Server;
  let origin: string;
  let clipDir: string;
  const pages = new Map<string, string>();
  const clips = new Map<string, Buffer>();

  beforeAll(async () => {
    clipDir = mkdtempSync(join(tmpdir(), "hf-video-alpha-"));
    for (const [name, args] of Object.entries(CLIPS)) {
      const result = spawnSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        ...args,
        join(clipDir, name),
      ]);
      if (result.status !== 0) throw new Error(`ffmpeg ${name}: ${result.stderr}`);
      clips.set(`/${name}`, readFileSync(join(clipDir, name)));
    }
    server = createServer((request, response) => {
      const path = (request.url ?? "/").split("?")[0] ?? "/";
      const html = pages.get(path);
      if (html) {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(html);
        return;
      }
      const body = clips.get(path);
      if (body) serveByteRange(body, request.headers.range, response);
      else response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await launchManagedBrowser(puppeteer, { executablePath, args: ["--no-sandbox"] });
  });

  afterAll(async () => {
    if (browser) await closeManagedBrowser(browser);
    await new Promise((resolve) => server?.close(resolve));
    if (clipDir) rmSync(clipDir, { recursive: true, force: true });
  });

  async function audit(html: string, seekTo: number | null = 0.25): Promise<AuditIssue[]> {
    const path = `/page-${pages.size}.html`;
    pages.set(path, html);
    const tab = await browser.newPage();
    try {
      await tab.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
      await tab.goto(`${origin}${path}`);
      if (seekTo !== null) {
        await tab.evaluate(async (time) => {
          const video = document.querySelector("video");
          if (!video) return;
          if (video.readyState < 2) {
            await new Promise((resolve) => video.addEventListener("loadeddata", resolve));
          }
          video.currentTime = time;
          await new Promise((resolve) => video.addEventListener("seeked", resolve));
        }, seekTo);
      }
      await tab.addScriptTag({ content: script });
      return await tab.evaluate(() => window.__hyperframesLayoutAudit({ time: 1, tolerance: 2 }));
    } finally {
      await tab.close();
    }
  }

  const occlusionOf = (issues: AuditIssue[], id: string) =>
    issues.find((issue) => issue.code === "text_occluded" && issue.selector === `#${id}`);

  it("keeps an opaque video occluding its whole box", async () => {
    const issues = await audit(page(videoTag("opaque.webm"), word("hidden", 480, "SHIP")));
    expect(occlusionOf(issues, "hidden")).toMatchObject({ severity: "error", coveredFraction: 1 });
    expect(issues.some((issue) => issue.code === "video_alpha_unread")).toBe(false);
  });

  it("does not flag text behind the transparent part of a cutout", async () => {
    const issues = await audit(page(videoTag("cutout.webm"), word("clear", 480, "SHIP")));
    expect(occlusionOf(issues, "clear")).toBeUndefined();
  });

  it("reports a word half under the subject's matte as info with its coverage", async () => {
    const issues = await audit(page(videoTag("cutout.webm"), word("tucked", 320, "SHIP")));
    const finding = occlusionOf(issues, "tucked");
    expect(finding).toMatchObject({ severity: "info", containerSelector: "#clip" });
    expect(finding?.coveredFraction).toBeGreaterThan(0.4);
    expect(finding?.coveredFraction).toBeLessThan(0.6);
    expect(finding?.message).toMatch(/"SHIP" is \d+% hidden/);
  });

  it("fails a word that the matte covers entirely", async () => {
    const issues = await audit(page(videoTag("cutout.webm"), word("eaten", 160, "SHIP")));
    expect(occlusionOf(issues, "eaten")).toMatchObject({ severity: "error", coveredFraction: 1 });
  });

  it("fails two neighbouring words that are each at least half covered", async () => {
    const line = `<span id="pair" style="position:absolute;left:200px;top:160px;margin:0;font:700 48px/1 Arial;color:#fff;white-space:nowrap">IN SHIP</span>`;
    const issues = await audit(page(videoTag("horizon.webm"), line));
    const finding = occlusionOf(issues, "pair");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toMatch(/Neighbouring words "IN" and "SHIP"/);
  });

  it("reads the frame the video was seeked to", async () => {
    const html = page(
      videoTag("cutout.webm"),
      word("left", 160, "SHIP") + word("right", 480, "SHIP"),
    );
    const early = await audit(html, 0.25);
    const late = await audit(html, 0.75);
    expect(occlusionOf(early, "left")?.severity).toBe("error");
    expect(occlusionOf(early, "right")).toBeUndefined();
    expect(occlusionOf(late, "left")).toBeUndefined();
    expect(occlusionOf(late, "right")?.severity).toBe("error");
  });

  it("fails a word hidden by a matte feature narrower than the probe grid", async () => {
    const issues = await audit(page(videoTag("strip.webm"), STRIP_CAPTION));
    const finding = occlusionOf(issues, "line");
    expect(finding).toMatchObject({ severity: "error", containerSelector: "#clip" });
    expect(finding?.message).toMatch(/"gh" is 100% behind/);
  });

  it("reads a mirrored cutout's alpha on the side it is painted", async () => {
    const issues = await audit(
      page(
        videoTag("cutout.webm", "", "transform:scaleX(-1)"),
        word("shown", 160, "SHIP") + word("hidden", 480, "SHIP"),
      ),
    );
    expect(occlusionOf(issues, "shown")).toBeUndefined();
    expect(occlusionOf(issues, "hidden")).toMatchObject({ severity: "error", coveredFraction: 1 });
  });

  it("keeps a cutout's opaque CSS background occluding behind its clear pixels", async () => {
    const issues = await audit(
      page(videoTag("cutout.webm", "", "background:#123456"), word("boxed", 480, "SHIP")),
    );
    expect(occlusionOf(issues, "boxed")).toMatchObject({ severity: "error" });
  });

  it("judges a rotated cutout as opaque and says why", async () => {
    const issues = await audit(
      page(videoTag("cutout.webm", "", "transform:rotate(90deg)"), word("turned", 480, "SHIP")),
    );
    expect(occlusionOf(issues, "turned")).toMatchObject({ severity: "error" });
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "video_alpha_unread", selector: "#clip" }),
    );
  });

  it("respects data-layout-allow-occlusion on text behind a cutout", async () => {
    const issues = await audit(
      page(videoTag("cutout.webm"), word("waived", 160, "SHIP", "data-layout-allow-occlusion")),
    );
    expect(occlusionOf(issues, "waived")).toBeUndefined();
  });

  it("falls back to opaque with an info note when no frame has been decoded", async () => {
    const issues = await audit(
      page(videoTag("cutout.webm", 'preload="none"'), word("unknown", 480, "SHIP")),
      null,
    );
    expect(occlusionOf(issues, "unknown")?.severity).toBe("error");
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "video_alpha_unread", severity: "info", selector: "#clip" }),
    );
  });
});
