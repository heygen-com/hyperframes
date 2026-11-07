import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { closeTestChrome, launchTestChrome, listenOnLoopback } from "./__fixtures__/loopback.js";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { captureDeVerificationFrames, type CaptureSession } from "./frameCapture.js";

const chromePath = resolveHeadlessShellPath();
const hasBrowser = chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;

const HF_PAGE = `<!doctype html><html><body style="margin:0"><script>
  window.__hf = {
    duration: 2,
    seek(t) { document.body.style.background = "rgb(" + Math.round(t * 100) + ",0,0)"; },
  };
</script>`;

describe.skipIf(!hasBrowser)("drawElement self-verify arming", () => {
  let browser: Browser;
  let server: Server;
  let serverUrl: string;
  let served = HF_PAGE;
  const pages: Page[] = [];
  const priorSamples = process.env.HF_DE_VERIFY;

  beforeAll(async () => {
    browser = await launchTestChrome(chromePath);
    server = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(served);
    });
    serverUrl = await listenOnLoopback(server);
  });

  afterEach(async () => {
    served = HF_PAGE;
    if (priorSamples === undefined) delete process.env.HF_DE_VERIFY;
    else process.env.HF_DE_VERIFY = priorSamples;
    await Promise.all(pages.splice(0).map((page) => page.close()));
  });

  afterAll(async () => {
    await closeTestChrome(browser);
    await new Promise((resolve) => server.close(resolve));
  });

  const arm = async (html = HF_PAGE) => {
    served = html;
    const page = await browser.newPage();
    pages.push(page);
    await page.goto(`${serverUrl}/index.html`);
    const session = {
      browser,
      page,
      serverUrl,
      onBeforeCapture: null,
      scriptLoadFailures: [],
      subTimelineWaitMemo: {},
      options: {
        width: 64,
        height: 64,
        fps: { num: 30, den: 1 },
        format: "jpeg",
        compositionDurationSeconds: 2,
      },
    } as unknown as CaptureSession;
    await captureDeVerificationFrames(session, page, () => {});
    return session.deVerifyFrames;
  };

  it("takes the ground truth at the fixed fractions, each showing its own frame", async () => {
    const frames = await arm();
    // 60 frames at fractions 1/4, 1/2, 3/4 and 0.95.
    expect([...(frames?.keys() ?? [])]).toEqual([15, 30, 45, 57]);
    expect(new Set([...(frames?.values() ?? [])].map((b) => b.toString("base64"))).size).toBe(4);
    for (const truth of frames?.values() ?? []) {
      expect(truth.subarray(0, 2).toString("hex")).toBe("ffd8");
    }
  });

  it("honours the requested sample count", async () => {
    process.env.HF_DE_VERIFY = "1";
    expect([...((await arm())?.keys() ?? [])]).toEqual([57]);
  });

  it("arms nothing when self-verify is turned off", async () => {
    process.env.HF_DE_VERIFY = "0";
    expect(await arm()).toBeUndefined();
  });

  it("moves a sample off a clip cut", async () => {
    const frames = await arm(`${HF_PAGE}<div data-start="0" data-duration="1"></div>`);
    expect(frames?.has(30)).toBe(false);
    expect(frames?.size).toBe(4);
  });

  it("arms nothing on a video composition with no frame injector, whose truth would be black", async () => {
    expect(await arm(`${HF_PAGE}<video></video>`)).toBeUndefined();
  });
});
