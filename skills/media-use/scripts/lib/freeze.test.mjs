import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freezeContent, isDirectMediaUrl } from "./freeze.mjs";

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

test("accepts direct X image URLs with query-string formats", () => {
  assert.equal(isDirectMediaUrl("https://pbs.twimg.com/media/example?format=jpg&name=large"), true);
  assert.equal(isDirectMediaUrl("https://pbs.twimg.com/media/example?format=html"), false);
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

test("freezeContent writes bounded structured provider output", () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-freeze-test-"));
  try {
    const out = join(dir, "tweet.json");
    assert.equal(freezeContent('{"kind":"x_post"}\n', out), 18);
    assert.equal(readFileSync(out, "utf8"), '{"kind":"x_post"}\n');
    assert.throws(() => freezeContent("", out), /empty inline content/);
    assert.throws(
      () => freezeContent(Buffer.alloc(4 * 1024 * 1024 + 1), out),
      /inline content exceeds 4194304 bytes/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
