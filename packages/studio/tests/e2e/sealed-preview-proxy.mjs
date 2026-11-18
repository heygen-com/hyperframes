// A sealed preview asks for a video's proxy copy the way the runtime does (proxyWait.ts) and must get past
// the request's CORS preflight. STUDIO_URL: a Studio started with VITE_STUDIO_OPAQUE_PREVIEW_ENABLED=1 on a
// project holding clip.mov.
import assert from "node:assert/strict";
import { launchStudioChrome } from "./chrome-executable.mjs";

const url = process.env.STUDIO_URL;
assert(url, "STUDIO_URL must point at a sealed Studio's project that holds clip.mov");
const { browser } = await launchStudioChrome();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(90_000);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("hyperframes-player")?.painted === true);
  const frame = page.frames().find((f) => /\/preview\/~[\w-]{43}/.test(f.url()));
  assert.ok(frame, "the preview loads under its frame token");
  const answer = await frame.evaluate(async () => {
    const origin = String(window.origin);
    try {
      const res = await fetch("clip.mov?hf-proxy=1", {
        headers: { Range: "bytes=0-0", "X-HF-Proxy-Priority": "1" },
        cache: "no-store",
      });
      void res.body?.cancel();
      return { origin, status: res.status, retryAfter: res.headers.get("Retry-After") };
    } catch (err) {
      return { origin, error: String(err) };
    }
  });
  console.log(JSON.stringify(answer));
  assert.equal(answer.origin, "null", "the preview frame is sealed");
  assert.equal(answer.error, undefined, "the proxy wait gets past its preflight");
  assert.equal(typeof answer.status, "number", "the frame reads the answer");
  if (answer.status === 202)
    assert.ok(answer.retryAfter, "a pending copy's Retry-After is readable");
} finally {
  await browser.close();
}
