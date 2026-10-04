import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./heygen-voice.mjs";

const realFetch = globalThis.fetch;
const savedEnv = {
  HEYGEN_ACCESS_TOKEN: process.env.HEYGEN_ACCESS_TOKEN,
  HEYGEN_API_KEY: process.env.HEYGEN_API_KEY,
};
let dir;
let calls;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "heygen-voice-"));
  delete process.env.HEYGEN_ACCESS_TOKEN;
  process.env.HEYGEN_API_KEY = "hg_test";
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

// routes: "METHOD /path" → array of [status, body] answered in order (last one repeats).
function mockFetch(routes) {
  globalThis.fetch = async (url, opts) => {
    const key = `${opts.method} ${String(url).replace("https://api.heygen.com/v3", "")}`;
    calls.push({ key, opts });
    const queue = routes[key];
    if (!queue) throw new Error(`unexpected request ${key}`);
    const [status, body] = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(body), { status });
  };
}

async function run(argv, { sleep = async () => {}, now = () => 0 } = {}) {
  const out = [];
  const err = [];
  const code = await main(argv, {
    sleep,
    now,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function audioFile(name = "sample.mp3") {
  const path = join(dir, name);
  writeFileSync(path, Buffer.from("fake-audio"));
  return path;
}

test("clone uploads base64 audio, polls until complete, prints the voice id", async () => {
  mockFetch({
    "POST /voices/clone": [[200, { data: { voice_clone_id: "vc1" } }]],
    "GET /voices/vc1": [
      [200, { data: { status: "processing", voice_id: "vc1" } }],
      [200, { data: { status: "complete", voice_id: "vc1", name: "Me" } }],
    ],
  });
  const sleeps = [];
  const r = await run(["clone", audioFile(), "--name", "Me"], {
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.deepEqual(r, { code: 0, out: '{"voice_id":"vc1"}', err: "" });
  assert.deepEqual(sleeps, [2000]);
  const post = calls[0];
  assert.equal(post.opts.headers["X-Api-Key"], "hg_test");
  assert.deepEqual(JSON.parse(post.opts.body), {
    voice_name: "Me",
    audio: {
      type: "base64",
      media_type: "audio/mpeg",
      data: Buffer.from("fake-audio").toString("base64"),
    },
  });
});

test("clone sends audio/wav for a .wav file", async () => {
  mockFetch({
    "POST /voices/clone": [[200, { data: { voice_clone_id: "vc1" } }]],
    "GET /voices/vc1": [[200, { data: { status: "complete", voice_id: "vc1" } }]],
  });
  const r = await run(["clone", audioFile("take.WAV"), "--name", "Me"]);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(calls[0].opts.body).audio.media_type, "audio/wav");
});

test("clone prints HeyGen's refusal verbatim and exits 1", async () => {
  const message =
    "Voice clone limit reached (10). Delete unused clones or contact support to increase your limit.";
  mockFetch({
    "POST /voices/clone": [[400, { error: { code: "resource_limit_reached", message } }]],
  });
  const r = await run(["clone", audioFile(), "--name", "Me"]);
  assert.deepEqual(r, { code: 1, out: "", err: message });
});

test("clone surfaces a failed clone's failure_message", async () => {
  mockFetch({
    "POST /voices/clone": [[200, { data: { voice_clone_id: "vc1" } }]],
    "GET /voices/vc1": [[200, { data: { status: "failed", failure_message: "Audio too noisy" } }]],
  });
  const r = await run(["clone", audioFile(), "--name", "Me"]);
  assert.deepEqual(r, { code: 1, out: "", err: "Audio too noisy" });
});

test("clone gives up after the 120 s deadline", async () => {
  mockFetch({
    "POST /voices/clone": [[200, { data: { voice_clone_id: "vc1" } }]],
    "GET /voices/vc1": [[200, { data: { status: "processing" } }]],
  });
  let clock = 0;
  const r = await run(["clone", audioFile(), "--name", "Me"], {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  assert.deepEqual(r, { code: 1, out: "", err: "voice clone vc1 not ready after 120 s" });
  assert.equal(calls.filter((c) => c.key === "GET /voices/vc1").length, 61);
});

test("clone rejects an audio type other than mp3 or wav without calling HeyGen", async () => {
  mockFetch({});
  const r = await run(["clone", audioFile("take.ogg"), "--name", "Me"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /use \.mp3 or \.wav/);
  assert.equal(calls.length, 0);
});

test("delete calls DELETE /voices/<id> and exits 0", async () => {
  mockFetch({ "DELETE /voices/vc1": [[200, { data: {} }]] });
  const r = await run(["delete", "vc1"]);
  assert.deepEqual(r, { code: 0, out: "", err: "" });
});

test("delete prints HeyGen's 404 message verbatim and exits 1", async () => {
  mockFetch({
    "DELETE /voices/gone": [
      [404, { error: { code: "voice_not_found", message: "Voice not found: gone" } }],
    ],
  });
  const r = await run(["delete", "gone"]);
  assert.deepEqual(r, { code: 1, out: "", err: "Voice not found: gone" });
});

test("list pages through private voices and returns prefix matches with created_at", async () => {
  mockFetch({
    "GET /voices?type=private&limit=100": [
      [
        200,
        {
          data: [
            { voice_id: "a", name: "desk-1" },
            { voice_id: "b", name: "other" },
          ],
          has_more: true,
          next_token: "t2",
        },
      ],
    ],
    "GET /voices?type=private&limit=100&token=t2": [
      [200, { data: [{ voice_id: "c", name: "desk-2" }], has_more: false }],
    ],
    "GET /voices/a": [[200, { data: { voice_id: "a", created_at: 1700000000 } }]],
    "GET /voices/c": [[200, { data: { voice_id: "c", created_at: 1700000100 } }]],
  });
  const r = await run(["list", "--prefix", "desk-"]);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out), [
    { voice_id: "a", name: "desk-1", created_at: 1700000000 },
    { voice_id: "c", name: "desk-2", created_at: 1700000100 },
  ]);
});

test("list prints HeyGen's refusal verbatim and exits 1", async () => {
  const message = "Invalid or expired API key. Verify your x-api-key header.";
  mockFetch({
    "GET /voices?type=private&limit=100": [[401, { error: { code: "unauthorized", message } }]],
  });
  const r = await run(["list", "--prefix", "desk-"]);
  assert.deepEqual(r, { code: 1, out: "", err: message });
});

test("a host-injected HEYGEN_ACCESS_TOKEN is sent as Bearer", async () => {
  process.env.HEYGEN_ACCESS_TOKEN = "at_host";
  mockFetch({ "DELETE /voices/vc1": [[200, { data: {} }]] });
  await run(["delete", "vc1"]);
  assert.equal(calls[0].opts.headers.Authorization, "Bearer at_host");
  assert.equal(calls[0].opts.headers["X-Api-Key"], undefined);
});
