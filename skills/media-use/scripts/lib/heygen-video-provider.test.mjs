import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HEYGEN_AUTH_COMMAND, HEYGEN_NOT_AUTHENTICATED_MESSAGE } from "./heygen-cli.mjs";

const VIDEO_FIXTURE = Buffer.from("tiny heygen video fixture");
const ONBOARDING_MESSAGE = `media-use: avatar video is free for new API users — sign in: ${HEYGEN_AUTH_COMMAND}`;
let importCount = 0;

async function freshGenerate() {
  importCount += 1;
  const module = await import(`./heygen-video-provider.mjs?test=${importCount}`);
  return module.heygenVideoGenerate;
}

async function listenVideoServer() {
  const server = http.createServer((req, res) => {
    if (req.url !== "/video.mp4") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-length": VIDEO_FIXTURE.length,
      "content-type": "video/mp4",
    });
    res.end(VIDEO_FIXTURE);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    server,
    url: `http://127.0.0.1:${address.port}/video.mp4`,
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function withFakeHeygen(options, run) {
  const dir = mkdtempSync(join(tmpdir(), "media-use-heygen-video-provider-"));
  const capturePath = join(dir, "argv.log");
  const heygenPath = join(dir, "heygen");
  const previousEnv = {
    PATH: process.env.PATH,
    HEYGEN_CAPTURE_PATH: process.env.HEYGEN_CAPTURE_PATH,
    HEYGEN_VIDEO_MODE: process.env.HEYGEN_VIDEO_MODE,
    HEYGEN_VIDEO_RESPONSE: process.env.HEYGEN_VIDEO_RESPONSE,
    HYPERFRAMES_NO_TELEMETRY: process.env.HYPERFRAMES_NO_TELEMETRY,
  };

  writeFileSync(
    heygenPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$HEYGEN_CAPTURE_PATH"
case "$*" in
  *"avatar list"*) printf '%s\\n' '{"data":[{"avatar_id":"avatar-public-1"}]}' ;;
  *"voice list"*) printf '%s\\n' '{"data":[{"voice_id":"voice-starfish-1"}]}' ;;
  *"video create"*)
    case "$HEYGEN_VIDEO_MODE" in
      auth) printf '%s\\n' 'HTTP 401 Unauthorized' >&2; exit 1 ;;
      other) printf '%s\\n' 'provider unavailable' >&2; exit 1 ;;
      *) printf '%s\\n' "$HEYGEN_VIDEO_RESPONSE" ;;
    esac
    ;;
esac
`,
  );
  chmodSync(heygenPath, 0o755);
  process.env.PATH = `${dir}:${previousEnv.PATH ?? ""}`;
  process.env.HEYGEN_CAPTURE_PATH = capturePath;
  process.env.HEYGEN_VIDEO_MODE = options.mode ?? "success";
  process.env.HEYGEN_VIDEO_RESPONSE = options.response ?? "";
  process.env.HYPERFRAMES_NO_TELEMETRY = "1";

  try {
    return await run({
      invocations: () => readFileSync(capturePath, "utf8").trim().split("\n"),
    });
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function bodyFromInvocation(invocation) {
  const marker = " -d ";
  const start = invocation.indexOf(marker);
  assert.notEqual(start, -1);
  return JSON.parse(invocation.slice(start + marker.length));
}

test("downloads a generated avatar video and returns the generated MP4 result", async () => {
  const { server, url } = await listenVideoServer();
  let localPath;
  try {
    await withFakeHeygen(
      { response: JSON.stringify({ data: { video_url: url } }) },
      async ({ invocations }) => {
        const heygenVideoGenerate = await freshGenerate();
        const intent = "Welcome to the HyperFrames launch";
        const result = await heygenVideoGenerate(intent, {});
        localPath = result?.localPath;
        const calls = invocations();
        const create = calls.find((call) => call.includes("video create"));

        assert.ok(create);
        assert.match(create, /--headers X-HeyGen-Client-Source: media-use/);
        assert.deepEqual(bodyFromInvocation(create), {
          type: "avatar",
          avatar_id: "avatar-public-1",
          script: intent,
          voice_id: "voice-starfish-1",
        });
        assert.ok(result);
        assert.equal(join(tmpdir(), result.localPath.slice(tmpdir().length + 1)), result.localPath);
        assert.match(result.localPath, /media-use-heygen-video-\d+-\d+\.mp4$/);
        assert.deepEqual(result, {
          localPath: result.localPath,
          ext: ".mp4",
          source: "generated",
          metadata: {
            description: intent,
            provider: "heygen.video",
            provenance: { prompt: intent },
          },
        });
        assert.deepEqual(readFileSync(result.localPath), VIDEO_FIXTURE);
      },
    );
  } finally {
    if (localPath) rmSync(localPath, { force: true });
    await closeServer(server);
  }
});

test("tags video creation but not avatar or voice discovery", async () => {
  const { server, url } = await listenVideoServer();
  let localPath;
  try {
    await withFakeHeygen(
      { response: JSON.stringify({ data: { video_url: url } }) },
      async ({ invocations }) => {
        const heygenVideoGenerate = await freshGenerate();
        const result = await heygenVideoGenerate("Header regression guard", {});
        localPath = result?.localPath;
        const calls = invocations();

        assert.equal(calls.length, 3);
        assert.match(calls[0], /^avatar list --ownership public --limit 1$/);
        assert.doesNotMatch(calls[0], /X-HeyGen-Client-Source/);
        assert.match(calls[1], /^voice list --engine starfish --limit 1$/);
        assert.doesNotMatch(calls[1], /X-HeyGen-Client-Source/);
        assert.match(calls[2], /video create/);
        assert.match(calls[2], /X-HeyGen-Client-Source: media-use/);
      },
    );
  } finally {
    if (localPath) rmSync(localPath, { force: true });
    await closeServer(server);
  }
});

test("uses explicit avatar and voice overrides without discovery", async () => {
  const { server, url } = await listenVideoServer();
  let localPath;
  try {
    await withFakeHeygen(
      { response: JSON.stringify({ data: { video_url: url } }) },
      async ({ invocations }) => {
        const heygenVideoGenerate = await freshGenerate();
        const result = await heygenVideoGenerate("Use my presenter", {
          avatarId: "avatar-override",
          voiceId: "voice-override",
        });
        localPath = result?.localPath;
        const calls = invocations();

        assert.equal(calls.length, 1);
        assert.match(calls[0], /video create/);
        assert.deepEqual(bodyFromInvocation(calls[0]), {
          type: "avatar",
          avatar_id: "avatar-override",
          script: "Use my presenter",
          voice_id: "voice-override",
        });
      },
    );
  } finally {
    if (localPath) rmSync(localPath, { force: true });
    await closeServer(server);
  }
});

test("caches discovered avatar and voice IDs for the process", async () => {
  const { server, url } = await listenVideoServer();
  const localPaths = new Set();
  try {
    await withFakeHeygen(
      { response: JSON.stringify({ data: { video_url: url } }) },
      async ({ invocations }) => {
        const heygenVideoGenerate = await freshGenerate();
        for (const intent of ["First avatar video", "Second avatar video"]) {
          const result = await heygenVideoGenerate(intent, {});
          if (result) localPaths.add(result.localPath);
        }
        const calls = invocations();

        assert.equal(calls.filter((call) => call.startsWith("avatar list ")).length, 1);
        assert.equal(calls.filter((call) => call.startsWith("voice list ")).length, 1);
        assert.equal(calls.filter((call) => call.includes("video create")).length, 2);
      },
    );
  } finally {
    for (const localPath of localPaths) rmSync(localPath, { force: true });
    await closeServer(server);
  }
});

test("prints auth onboarding and reports an unauthenticated create failure", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(message));

  await withFakeHeygen({ mode: "auth" }, async () => {
    const heygenVideoGenerate = await freshGenerate();
    const result = await heygenVideoGenerate("Sign-in failure", {
      avatarId: "avatar-override",
      voiceId: "voice-override",
    });

    assert.equal(result, null);
    assert.ok(errors.includes(ONBOARDING_MESSAGE));
    assert.ok(errors.includes(HEYGEN_NOT_AUTHENTICATED_MESSAGE));
  });
});

test("reports other create failures without auth onboarding", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(message));

  await withFakeHeygen({ mode: "other" }, async () => {
    const heygenVideoGenerate = await freshGenerate();
    const result = await heygenVideoGenerate("Provider failure", {
      avatarId: "avatar-override",
      voiceId: "voice-override",
    });

    assert.equal(result, null);
    assert.ok(!errors.includes(ONBOARDING_MESSAGE));
    assert.ok(errors.includes("media-use: `heygen video create` failed: provider unavailable"));
  });
});

test("falls through on non-JSON and error responses", async (t) => {
  t.mock.method(console, "error", () => {});

  for (const response of ["not JSON", '{"error":{"message":"render failed"}}']) {
    await withFakeHeygen({ response }, async () => {
      const heygenVideoGenerate = await freshGenerate();
      const result = await heygenVideoGenerate("Unusable response", {
        avatarId: "avatar-override",
        voiceId: "voice-override",
      });

      assert.equal(result, null);
    });
  }
});
