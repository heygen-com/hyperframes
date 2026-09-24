import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDirectMediaUrl, freezeUrl, freezeLocalFile } from "./freeze.mjs";

const HOSTILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>' +
  '<rect onload="alert(2)" width="1" height="1"/>' +
  '<a href="javascript:alert(3)"><circle r="1"/></a></svg>';

test("accepts direct public media URLs", () => {
  assert.equal(isDirectMediaUrl("https://cdn.example.com/clip.mp4"), true);
  assert.equal(isDirectMediaUrl("https://example.com/a/b/track.mp3"), true);
  assert.equal(isDirectMediaUrl("http://example.com/logo.svg"), true);
});

test("rejects platform pages (no yt-dlp)", () => {
  assert.equal(isDirectMediaUrl("https://www.youtube.com/watch?v=abc"), false);
  assert.equal(isDirectMediaUrl("https://youtu.be/abc"), false);
  assert.equal(isDirectMediaUrl("https://vimeo.com/12345"), false);
  assert.equal(isDirectMediaUrl("https://x.com/u/status/1"), false);
});

test("rejects non-direct / non-media URLs", () => {
  assert.equal(isDirectMediaUrl("https://example.com/page"), false, "no media extension");
  assert.equal(isDirectMediaUrl("ftp://example.com/a.mp4"), false, "non-http(s)");
  assert.equal(isDirectMediaUrl("not a url"), false);
});

test("rejects local / private hosts (SSRF guard, m11)", () => {
  for (const u of [
    "http://localhost/a.mp4",
    "http://127.0.0.1/a.mp4",
    "http://127.1.2.3/a.mp4",
    "http://0.0.0.0/a.mp4",
    "http://10.0.0.5/a.mp4",
    "http://192.168.1.1/a.mp4",
    "http://172.16.0.1/a.mp4",
    "http://172.31.255.255/a.mp4",
    "http://169.254.169.254/a.mp4", // cloud metadata endpoint
    "http://printer.local/a.mp4",
    "http://svc.internal/a.mp4",
    "http://[::1]/a.mp4",
    "http://[fe80::1]/a.mp4",
    "http://[fd00::1]/a.mp4",
  ]) {
    assert.equal(isDirectMediaUrl(u), false, `should block ${u}`);
  }
  // A public host that merely starts with similar digits is still allowed.
  assert.equal(isDirectMediaUrl("https://172.40.0.1/a.mp4"), true, "172.40 is public");
  assert.equal(isDirectMediaUrl("https://11.example.com/a.mp4"), true);
});

test("freezeUrl strips <script>, on* handlers and javascript: hrefs from a fetched SVG", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(HOSTILE_SVG, { status: 200, headers: { "content-type": "image/svg+xml" } }),
  );
  const dest = join(mkdtempSync(join(tmpdir(), "media-use-freeze-")), "logo.svg");
  await freezeUrl("https://example.com/hostile.svg", dest);
  const out = readFileSync(dest, "utf8");
  assert.ok(!out.includes("<script"), "script element stripped");
  assert.ok(!out.includes("onload="), "event handler stripped");
  assert.ok(!out.includes("javascript:"), "javascript: href stripped");
  assert.ok(out.includes("<circle"), "benign markup survives");
});

// Puts setTimeout and AbortSignal.timeout on node:test's fake clock.
function fakeClock(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(AbortSignal, "timeout", (ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), ms);
    return controller.signal;
  });
}

test("freezeUrl keeps streaming a slow body past the header timeout", async (t) => {
  fakeClock(t);
  let body;
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    const stream = new ReadableStream({
      start(controller) {
        body = controller;
        // undici aborts the body stream too when the request signal fires.
        signal.addEventListener("abort", () => controller.error(signal.reason));
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
    });
    return new Response(stream, { status: 200 });
  });
  const dest = join(mkdtempSync(join(tmpdir(), "media-use-freeze-")), "clip.mp4");
  const frozen = freezeUrl("https://cdn.example.com/clip.mp4", dest);
  await new Promise(setImmediate);
  t.mock.timers.tick(60_000);
  body.enqueue(new Uint8Array([4, 5]));
  body.close();
  assert.equal(await frozen, 5);
  assert.deepEqual([...readFileSync(dest)], [1, 2, 3, 4, 5]);
});

test("freezeUrl times out when no response headers arrive", { timeout: 5_000 }, async (t) => {
  fakeClock(t);
  t.mock.method(
    globalThis,
    "fetch",
    (_url, { signal }) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  );
  const dest = join(mkdtempSync(join(tmpdir(), "media-use-freeze-")), "clip.mp4");
  const frozen = freezeUrl("https://cdn.example.com/clip.mp4", dest);
  t.mock.timers.tick(10_000);
  await assert.rejects(frozen, /no response within 10000 ms/);
});

test("freezeLocalFile strips the same hostile SVG content from a local source", () => {
  const srcDir = mkdtempSync(join(tmpdir(), "media-use-freeze-src-"));
  const src = join(srcDir, "in.svg");
  writeFileSync(src, HOSTILE_SVG);
  const dest = join(mkdtempSync(join(tmpdir(), "media-use-freeze-dest-")), "logo.svg");
  freezeLocalFile(src, dest);
  const out = readFileSync(dest, "utf8");
  assert.ok(!out.includes("<script"));
  assert.ok(!out.includes("onload="));
});

test("freezeLocalFile still byte-copies a non-SVG file untouched", () => {
  const srcDir = mkdtempSync(join(tmpdir(), "media-use-freeze-src-"));
  const src = join(srcDir, "in.png");
  writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const dest = join(mkdtempSync(join(tmpdir(), "media-use-freeze-dest-")), "logo.png");
  freezeLocalFile(src, dest);
  assert.deepEqual(readFileSync(dest), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});
