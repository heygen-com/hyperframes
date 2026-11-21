import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scriptsDir = new URL(".", import.meta.url).pathname;
const HOSTILE = "x\x1b]52;c;aGk=\x07\x1b[2J";
const SHOWN = "x\\x1b]52;c;aGk=\\x07\\x1b[2J";
const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

function run(script, args, home) {
  return execFileSync(process.execPath, [join(scriptsDir, script), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HYPERFRAMES_MEDIA_HOME: home },
  });
}

function assertEscaped(output) {
  assert.ok(output.includes(SHOWN), output);
  for (const raw of ["\x1b", "\x07"]) assert.ok(!output.includes(raw), JSON.stringify(output));
}

function withProject(fn) {
  const root = mkdtempSync(join(tmpdir(), "media-use-memory-output-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(project, ".media/recipes/promo"), { recursive: true });
  writeFileSync(join(project, "frame.md"), "# Frame spec\n");
  writeFileSync(
    join(project, ".media/recipes/promo/recipe.json"),
    JSON.stringify({
      name: "promo",
      version: 1,
      workflow: `launch-${HOSTILE}`,
      approved_at: "2026-11-18T00:00:00Z",
      destination: `feed-${HOSTILE}`,
    }),
  );
  writeFileSync(join(project, ".media/recipes/promo/frame.md"), "# Frame spec\n");
  writeFileSync(join(project, ".media/recipes/promo/storyboard-skeleton.md"), "## Frame 1\n");
  writeFileSync(
    join(project, ".media/preferences.json"),
    JSON.stringify({
      version: 1,
      preferences: {
        destination: { value: `feed-${HOSTILE}`, confirmed_in: [`proj-${HOSTILE}`] },
      },
    }),
  );
  try {
    fn({ project, home });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("recipe list and use print recipe.json text with control characters as visible escapes", () => {
  withProject(({ project, home }) => {
    assertEscaped(run("recipe.mjs", ["list", "--hyperframes", project], home));
    const used = run("recipe.mjs", ["use", "--hyperframes", project, "--name", "promo"], home);
    assertEscaped(used);
    assert.match(used, /destination: feed-x\\x1b/);
  });
});

test("recipe --json output keeps the stored value as it is", () => {
  withProject(({ project, home }) => {
    const list = JSON.parse(run("recipe.mjs", ["list", "--hyperframes", project, "--json"], home));
    assert.equal(list[0].workflow, `launch-${HOSTILE}`);
  });
});

test("prefs get prints remembered values with control characters as visible escapes", () => {
  withProject(({ project, home }) => {
    const shown = run("prefs.mjs", ["get", "--hyperframes", project], home);
    assertEscaped(shown);
    assert.match(shown, /confirmed in proj-x\\x1b/);
  });
});

test("prefs record echoes the recorded value with control characters as visible escapes", () => {
  withProject(({ project, home }) => {
    const shown = run(
      "prefs.mjs",
      ["record", "--hyperframes", project, "--key", "aspect", "--value", `16:9${HOSTILE}`],
      home,
    );
    assertEscaped(shown);
  });
});

test("a failing recipe command prints its error with control characters as visible escapes", () => {
  withProject(({ project, home }) => {
    const other = join(project, ".media/recipes/other");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "recipe.json"), JSON.stringify({ name: `other-${HOSTILE}` }));
    assert.throws(
      () => run("recipe.mjs", ["use", "--hyperframes", project, "--name", "nope"], home),
      (err) => {
        assertEscaped(String(err.stderr));
        return err.status === 1;
      },
    );
  });
});

function failingStderr(script, args) {
  const result = spawnSync(process.execPath, [join(scriptsDir, script), ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status === 0, false, result.stdout);
  return result.stderr;
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "media-use-script-output-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("audio-duck prints a voice id from audio_meta.json with control characters as escapes", () => {
  withTempDir((dir) => {
    const meta = join(dir, "audio_meta.json");
    const words = [{ text: "hi", start: 0, end: 0.5 }];
    writeFileSync(meta, JSON.stringify({ voices: [{ id: HOSTILE, words }] }));
    const args = ["--meta", meta, "--target", "#bgm", "--offsets", "other=0"];
    assertEscaped(failingStderr("audio-duck.mjs", args));
    const json = JSON.parse(
      spawnSync(process.execPath, [join(scriptsDir, "audio-duck.mjs"), ...args, "--json"], {
        encoding: "utf8",
      }).stdout,
    );
    assert.equal(json.error, `--offsets is missing voice "${HOSTILE}"`);
  });
});

test("audio-duck and transcript-cut print a broken JSON file's bytes as escapes", () => {
  withTempDir((dir) => {
    const broken = join(dir, "broken.json");
    writeFileSync(broken, `{"words": ${HOSTILE}}`);
    for (const shown of [
      failingStderr("audio-duck.mjs", ["--meta", broken, "--target", "#bgm"]),
      failingStderr("transcript-cut.mjs", ["--transcript", broken, "--plan"]),
    ]) {
      assert.match(shown, /x\\x1b\]52/);
      for (const raw of ["\x1b", "\x07"]) assert.ok(!shown.includes(raw), JSON.stringify(shown));
    }
  });
});

test("transcribe and dither print a missing input path with control characters as escapes", () => {
  withTempDir((dir) => {
    const missing = join(dir, `${HOSTILE}.wav`);
    assertEscaped(failingStderr("transcribe.mjs", ["--input", missing]));
    assertEscaped(failingStderr("dither.mjs", ["--input", missing, "--out", join(dir, "o.png")]));
  });
});

test(
  "transcript-cut and dither print output paths with control characters as escapes",
  { skip: !HAS_FFMPEG },
  () => {
    withTempDir((dir) => {
      const tone = join(dir, "tone.wav");
      const image = join(dir, "frame.png");
      const lavfi = ["-y", "-loglevel", "error", "-f", "lavfi", "-i"];
      execFileSync("ffmpeg", [...lavfi, "sine=frequency=440:duration=2", tone]);
      execFileSync("ffmpeg", [...lavfi, "color=size=8x8", "-frames:v", "1", image]);
      const transcript = join(dir, "words.json");
      writeFileSync(transcript, JSON.stringify([{ text: "hi", start: 0, end: 1 }]));
      const cut = ["--input", tone, "--transcript", transcript, "--remove", "1-2"];
      assertEscaped(run("transcript-cut.mjs", [...cut, "--out", join(dir, `${HOSTILE}.wav`)], dir));
      assertEscaped(
        run("dither.mjs", ["--input", image, "--out", join(dir, `${HOSTILE}.png`)], dir),
      );
    });
  },
);

test("audio-duck prints the --target value with control characters as escapes", () => {
  withTempDir((dir) => {
    const meta = join(dir, "audio_meta.json");
    writeFileSync(meta, JSON.stringify({ words: [{ text: "hi", start: 0, end: 0.5 }] }));
    assertEscaped(run("audio-duck.mjs", ["--meta", meta, "--target", HOSTILE], dir));
  });
});
