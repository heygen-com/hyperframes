import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const assembleScript = new URL("./assemble-index.mjs", import.meta.url).pathname;
const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

// ── bgm_pending at the assembly boundary ─────────────────────────────────────
// Regression: the flag survived into audio_meta.json but assemble rebuilt its audio object
// from three named keys and dropped it, so the step that actually builds the film could not
// tell "not ready yet" from "silent by design" and would ship the silent one.

function assembleWith({ audioMeta, extraArgs = [], beforeAssemble }) {
  const dir = mkdtempSync(join(tmpdir(), "product-launch-assemble-"));
  writeFileSync(
    join(dir, "STORYBOARD.md"),
    "---\nformat: 1920x1080\nmessage: T\n---\n\n## Frame 1 — A\n- duration: 3s\n- src: compositions/frames/01-a.html\n",
  );
  mkdirSync(join(dir, "compositions", "frames"), { recursive: true });
  writeFileSync(
    join(dir, "compositions", "frames", "01-a.html"),
    // pr-to-video's frame contract wants one bare <template> whose inner root carries the
    // composition id and duration (lib/frame-contract.mjs).
    '<template><div data-composition-id="01-a" data-width="1920" data-height="1080" ' +
      'data-duration="3"><section class="clip" data-start="0" data-duration="3"></section>' +
      "</div></template>",
  );
  if (audioMeta) writeFileSync(join(dir, "audio_meta.json"), JSON.stringify(audioMeta));
  if (beforeAssemble) beforeAssemble(dir);
  const r = spawnSync(
    process.execPath,
    [
      assembleScript,
      "--storyboard",
      join(dir, "STORYBOARD.md"),
      "--hyperframes",
      dir,
      ...extraArgs,
    ],
    { encoding: "utf8" },
  );
  return { dir, r };
}

test("assemble REFUSES while bgm_pending and no bed on disk", () => {
  const { dir, r } = assembleWith({
    audioMeta: { bgm: null, bgm_pending: true, voices: [], sfx: [] },
  });

  assert.notEqual(r.status, 0, "should not assemble a silent film over a pending bed");
  assert.match(r.stderr, /bgm_pending/);
  // Refusing means producing nothing, not a half-built index.
  assert.equal(existsSync(join(dir, "index.html")), false);
});

test("--allow-pending-bgm assembles anyway, and says so", () => {
  const { dir, r } = assembleWith({
    audioMeta: { bgm: null, bgm_pending: true, voices: [], sfx: [] },
    extraArgs: ["--allow-pending-bgm"],
  });

  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(dir, "index.html")), true);
  assert.match(r.stdout + r.stderr, /pending/i);
});

test("a film that is silent BY DESIGN still assembles untouched", () => {
  // The whole point of carrying the flag: this case must stay distinguishable from the above.
  const { dir, r } = assembleWith({ audioMeta: { bgm: null, voices: [], sfx: [] } });

  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(dir, "index.html")), true);
  assert.doesNotMatch(r.stderr, /bgm_pending/);
});

// ── PRINFRA-309: loop-extended BGM must be a real .mp3, not MP3-in-a-.wav ────
// ensureBgmCovers() always encodes the loop-extended track with libmp3lame — so a source
// asset named "*.wav" that's short of TOTAL used to come out as MP3 audio inside a
// .loop.wav-named file: decodes fine via ffprobe/ffmpeg/Chromium (which sniff the real
// WAVE_FORMAT_MPEGLAYER3 tag), but hard-fails in any naive/strict WAV parser (e.g. Python's
// stdlib `wave` module) that doesn't do full format-tag dispatch.
test(
  "loop-extended bgm is written as .mp3, not .loop.wav, even when the source is a .wav",
  { skip: !HAS_FFMPEG },
  () => {
    const { dir, r } = assembleWith({
      audioMeta: { bgm: { path: "assets/bgm/bed.wav" }, voices: [], sfx: [] },
      beforeAssemble: (projectDir) => {
        mkdirSync(join(projectDir, "assets", "bgm"), { recursive: true });
        // 1s tone, well short of the 3s TOTAL from the single storyboard frame above —
        // guarantees ensureBgmCovers() takes the loop-extend branch.
        const gen = spawnSync(
          "ffmpeg",
          [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            join(projectDir, "assets", "bgm", "bed.wav"),
          ],
          { encoding: "utf8" },
        );
        assert.equal(gen.status, 0, gen.stderr);
      },
    });

    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(dir, "index.html"), "utf8");
    const bgmEl = html.match(/id="el-bgm"[\s\S]*?src="([^"]+)"/);
    assert.ok(bgmEl, "expected a bgm <audio> element in index.html");
    const bgmSrc = bgmEl[1];
    assert.match(bgmSrc, /\.mp3$/, `bgm src should end in .mp3, got "${bgmSrc}"`);
    assert.doesNotMatch(bgmSrc, /\.wav$/);

    const outPath = join(dir, bgmSrc);
    assert.equal(existsSync(outPath), true);
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", "--", outPath],
      { encoding: "utf8" },
    );
    assert.equal(probe.stdout.trim(), "mp3");
  },
);
