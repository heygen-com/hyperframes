import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probe } from "./probe.mjs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

function mockProbe(t, streams, format = { duration: "2" }) {
  t.mock.method(childProcess, "execFileSync", () => JSON.stringify({ streams, format }));
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}

const AUDIO_STREAM = { codec_type: "audio", codec_name: "aac", duration: "3" };
const VIDEO_STREAM = {
  codec_type: "video",
  codec_name: "h264",
  width: 64,
  height: 48,
  duration: "4",
};
const COVER_STREAM = {
  codec_type: "video",
  codec_name: "mjpeg",
  width: 100,
  height: 100,
  disposition: { attached_pic: 1 },
};

for (const [name, streams] of [
  ["audio before video", [AUDIO_STREAM, VIDEO_STREAM]],
  ["video before audio", [VIDEO_STREAM, AUDIO_STREAM]],
  ["cover art before video", [COVER_STREAM, AUDIO_STREAM, VIDEO_STREAM]],
]) {
  test(`probe selects the video stream with ${name}`, (t) => {
    mockProbe(t, streams);
    assert.deepEqual(probe("clip.mp4"), {
      duration: 2,
      width: 64,
      height: 48,
      codec: "h264",
    });
  });
}

test("probe selects audio metadata for an audio file with cover art", (t) => {
  mockProbe(t, [COVER_STREAM, AUDIO_STREAM]);
  assert.deepEqual(probe("song.m4a"), { duration: 2, width: null, height: null, codec: "aac" });
});

test("probe uses the selected video's duration when the container has none", (t) => {
  mockProbe(t, [AUDIO_STREAM, VIDEO_STREAM], {});
  assert.equal(probe("clip.mp4").duration, 4);
});

test("probe selects image dimensions without reporting an image duration", (t) => {
  mockProbe(t, [AUDIO_STREAM, VIDEO_STREAM]);
  assert.deepEqual(probe("frame.png"), {
    duration: null,
    width: 64,
    height: 48,
    codec: "h264",
  });
});

test("probe retains audio-only metadata and the empty-stream fallback", (t) => {
  mockProbe(t, [AUDIO_STREAM]);
  assert.deepEqual(probe("clip.mp4"), { duration: 2, width: null, height: null, codec: "aac" });
});

test("probe retains the container duration when no streams are reported", (t) => {
  mockProbe(t, []);
  assert.deepEqual(probe("clip.mp4"), { duration: 2, width: null, height: null, codec: null });
});

// Regression for the shell-injection fix: probe() must pass the path as a literal
// argv entry, never through a shell. A filename containing shell metacharacters
// must NOT execute. Under the old execSync(`ffprobe ... "${path}"`) the embedded
// `touch` ran and created the marker; under execFileSync it cannot, regardless of
// whether ffprobe is installed (the injected command never reaches a shell).
test("probe does not execute shell metacharacters in a filename", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-inject-"));
  const marker = join(dir, "INJECTED");
  // Slash-free basename (a real on-disk filename) that breaks out of the old
  // double-quoted interpolation and would `touch INJECTED` in the cwd.
  const evil = join(dir, `clip"; touch INJECTED; echo ".mp4`);
  const prevCwd = process.cwd();
  try {
    writeFileSync(evil, "not real media");
    process.chdir(dir); // so a leaked `touch INJECTED` would land next to `marker`
    const meta = probe(evil);
    assert.equal(existsSync(marker), false, "injected `touch` must not have run");
    // Bogus/unreadable media still returns the null-shaped result, never throws.
    assert.deepEqual(Object.keys(meta).sort(), ["codec", "duration", "height", "width"]);
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "probe runs the ffprobe HYPERFRAMES_FFPROBE_PATH names",
  { skip: process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-ffprobe-path-"));
    const fake = join(dir, "fake-ffprobe");
    writeFileSync(
      fake,
      `#!/bin/sh\n[ "$1" = -version ] && echo 'ffprobe version fake' && exit 0\necho '{"streams":[{"width":7,"height":3,"codec_name":"fake"}]}'\n`,
    );
    chmodSync(fake, 0o755);
    const configured = process.env.HYPERFRAMES_FFPROBE_PATH;
    process.env.HYPERFRAMES_FFPROBE_PATH = fake;
    try {
      assert.deepEqual(probe(join(dir, "clip.png")), {
        duration: null,
        width: 7,
        height: 3,
        codec: "fake",
      });
    } finally {
      if (configured === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
      else process.env.HYPERFRAMES_FFPROBE_PATH = configured;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("probe refuses an HYPERFRAMES_FFPROBE_PATH that cannot run instead of reporting no metadata", () => {
  const configured = process.env.HYPERFRAMES_FFPROBE_PATH;
  process.env.HYPERFRAMES_FFPROBE_PATH = join(tmpdir(), "no-ffprobe-here", "ffprobe");
  try {
    assert.throws(
      () => probe("clip.wav"),
      /HYPERFRAMES_FFPROBE_PATH names ".*no-ffprobe-here.*fix it or unset it/,
    );
  } finally {
    if (configured === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
    else process.env.HYPERFRAMES_FFPROBE_PATH = configured;
  }
});

test("probe refuses an HYPERFRAMES_FFPROBE_PATH that names a folder", () => {
  const configured = process.env.HYPERFRAMES_FFPROBE_PATH;
  process.env.HYPERFRAMES_FFPROBE_PATH = tmpdir();
  try {
    assert.throws(() => probe("clip.wav"), /HYPERFRAMES_FFPROBE_PATH names .*fix it or unset it/);
  } finally {
    if (configured === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
    else process.env.HYPERFRAMES_FFPROBE_PATH = configured;
  }
});

function withFfprobePath(value, run) {
  const configured = process.env.HYPERFRAMES_FFPROBE_PATH;
  process.env.HYPERFRAMES_FFPROBE_PATH = value;
  try {
    return run();
  } finally {
    if (configured === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
    else process.env.HYPERFRAMES_FFPROBE_PATH = configured;
  }
}

test(
  "probe refuses a configured ffprobe that cannot start, exits with an error, or is another tool",
  {
    skip: process.platform === "win32",
  },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-broken-ffprobe-"));
    try {
      const noInterpreter = join(dir, "no-interpreter");
      writeFileSync(noInterpreter, "#!/nonexistent/interpreter\n");
      const failing = join(dir, "failing");
      writeFileSync(failing, "#!/bin/sh\nexit 3\n");
      const otherTool = join(dir, "other-tool");
      writeFileSync(otherTool, "#!/bin/sh\necho 'ffmpeg version 9.9'\n");
      for (const broken of [noInterpreter, failing, otherTool]) {
        chmodSync(broken, 0o755);
        withFfprobePath(broken, () =>
          assert.throws(
            () => probe("clip.wav"),
            /HYPERFRAMES_FFPROBE_PATH names .*fix it or unset it/,
          ),
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "probe runs a relative HYPERFRAMES_FFPROBE_PATH from the working folder, not from PATH",
  {
    skip: process.platform === "win32",
  },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-relative-ffprobe-"));
    const prevCwd = process.cwd();
    try {
      writeFileSync(
        join(dir, "local-ffprobe"),
        `#!/bin/sh\n[ "$1" = -version ] && echo 'ffprobe version fake' && exit 0\necho '{"streams":[{"width":5,"height":4,"codec_name":"local"}]}'\n`,
      );
      chmodSync(join(dir, "local-ffprobe"), 0o755);
      process.chdir(dir);
      const meta = withFfprobePath("local-ffprobe", () => probe("clip.png"));
      assert.deepEqual(meta, { duration: null, width: 5, height: 4, codec: "local" });
    } finally {
      process.chdir(prevCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
