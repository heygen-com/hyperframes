import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fetchMedia, isPublicMediaUrl } from "./media-fetch.mjs";
import { freezeUrl } from "./freeze.mjs";
import { downloadTo } from "../../audio/scripts/lib/heygen.mjs";
import { synthesizeHeygen } from "../../audio/scripts/lib/tts.mjs";
import { faviconSearch } from "./logo-provider.mjs";

test("blocks private, reserved, alternate-encoded and mapped hosts", () => {
  for (const host of [
    "localhost",
    "localhost.",
    "a.localhost",
    "svc.internal",
    "svc.local",
    "127.1",
    "2130706433",
    "0x7f000001",
    "10.0.0.1",
    "169.254.169.254",
    "100.100.100.200",
    "192.168.1.1",
    "172.31.0.1",
    "224.0.0.1",
    "[::]",
    "[::1]",
    "[::ffff:127.0.0.1]",
    "[::ffff:a00:1]",
    "[fe80::1]",
    "[fd00::1]",
    "[ff02::1]",
  ]) {
    assert.equal(isPublicMediaUrl(`https://${host}/asset`), false, host);
  }
  for (const url of [
    "https://cdn.example/asset.cube",
    "http://example.com/clip.mp4",
    "https://8.8.8.8/a",
    "https://[::ffff:8.8.8.8]/a",
  ])
    assert.equal(isPublicMediaUrl(url), true, url);
  assert.equal(isPublicMediaUrl("file:///tmp/a.mp4"), false);
});

test("follows public relative redirects manually and forwards cancellation", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const response = await fetchMedia("https://cdn.example/a", {
    method: "HEAD",
    signal,
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, "manual");
      assert.equal(options.signal, signal);
      assert.equal(options.method, "HEAD");
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: "/b" } })
        : new Response("media");
    },
  });
  assert.deepEqual(calls, ["https://cdn.example/a", "https://cdn.example/b"]);
  assert.equal(await response.text(), "media");
});

test("rejects private redirect targets before requesting them and cancels redirect bodies", async () => {
  let calls = 0;
  let cancelled = false;
  await assert.rejects(
    fetchMedia("https://cdn.example/a", {
      fetchImpl: async () => {
        calls++;
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" },
          },
        );
      },
    }),
    /blocked/,
  );
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test("bounds redirect loops", async () => {
  let calls = 0;
  await assert.rejects(
    fetchMedia("https://cdn.example/a", {
      fetchImpl: async () => {
        calls++;
        return new Response(null, { status: 302, headers: { location: "/a" } });
      },
    }),
    /redirect limit/,
  );
  assert.equal(calls, 6);
});

test("freeze refuses a public-to-private redirect without writing response bytes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-freeze-redirect-"));
  t.mock.method(globalThis, "fetch", async (_url, options) =>
    options?.redirect === "manual"
      ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private.mp4" } })
      : new Response("private response"),
  );
  try {
    await assert.rejects(freezeUrl("https://cdn.example/a.mp4", join(dir, "out.mp4")), /blocked/);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const entry of ["heygen audio", "tts mp3", "tts wav", "favicon"]) {
  test(`${entry} blocks private redirects before saving or transcoding`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-provider-redirect-"));
    const requests = [];
    const fetchImpl = t.mock.method(globalThis, "fetch", async (url, options) => {
      requests.push(url);
      return options?.redirect === "manual"
        ? new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/private" },
          })
        : new Response(new Uint8Array(600));
    });
    try {
      if (entry === "heygen audio") {
        await assert.rejects(
          downloadTo("https://cdn.example/audio", join(dir, "audio.mp3")),
          /blocked/,
        );
      } else if (entry === "favicon") {
        assert.equal(await faviconSearch("GitHub logo"), null);
      } else {
        const result = await synthesizeHeygen(
          {
            text: "hi",
            voiceId: "v1",
            lang: "en",
            speed: 1,
            wavAbs: join(dir, entry === "tts wav" ? "audio.wav" : "audio.mp3"),
          },
          {
            heygenAuthHeaders: () => ({}),
            heygenJSON: async () => ({ data: { audio_url: "https://cdn.example/audio" } }),
            fetch: fetchImpl,
            transcodeToWav: () => assert.fail("private bytes must not reach ffmpeg"),
          },
        );
        assert.equal(result.ok, false);
        assert.match(result.error, /blocked/);
      }
      assert.equal(requests.length, 1);
      assert.deepEqual(readdirSync(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
