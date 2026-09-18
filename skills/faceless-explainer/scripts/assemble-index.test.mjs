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
    '<div data-composition-id="01-a" data-width="1920" data-height="1080">' +
      '<section class="clip" data-start="0" data-duration="3"></section></div>',
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

// ── voice clip edge fades ─────────────────────────────────────────────────────
// Voice clips are butt-joined with zero gap by the cumulative-start layout, and
// (pre-fix) mounted with zero edge fade — a hard cut at both edges, causing
// audible word-jumps/abrupt cuts at scene seams. This measures the actual RMS
// level in a short window at the very start of the mounted voice audio: a
// constant-amplitude tone should measure near its full level pre-fix, and a
// clearly quieter level once an in-fade is baked in.
function rmsDbAt(path, startSec, durSec) {
  const r = spawnSync(
    "ffmpeg",
    [
      "-i",
      path,
      "-af",
      `atrim=start=${startSec}:end=${startSec + durSec},astats=metadata=1:reset=1`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  // Mono input reports the same RMS level per-channel and "Overall" — take the
  // last occurrence (the "Overall" summary line) rather than anchor to it by
  // position, since every astats line carries its own `[Parsed_astats_N @ ...]`
  // prefix rather than being indented under a bare "Overall" heading.
  const matches = [...r.stderr.matchAll(/RMS level dB:\s*(-?[\d.]+|-inf)/g)];
  assert.ok(matches.length > 0, `expected an RMS level dB reading in ffmpeg stderr:\n${r.stderr}`);
  const value = matches.at(-1)[1];
  return value === "-inf" ? -Infinity : parseFloat(value);
}

test("voice clips get a short edge fade baked in, not a hard cut", { skip: !HAS_FFMPEG }, () => {
  const { dir, r } = assembleWith({
    audioMeta: { bgm: null, voices: [{ frame: 1, path: "assets/voice/01.wav" }], sfx: [] },
    beforeAssemble: (projectDir) => {
      mkdirSync(join(projectDir, "assets", "voice"), { recursive: true });
      // A constant-amplitude tone spanning the full 3s frame duration: with no
      // fade, the start/end windows measure the same RMS level as the middle.
      const gen = spawnSync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=3",
          join(projectDir, "assets", "voice", "01.wav"),
        ],
        { encoding: "utf8" },
      );
      assert.equal(gen.status, 0, gen.stderr);
    },
  });

  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const voiceEl = html.match(/id="el-[^"]*-voice"[\s\S]*?src="([^"]+)"/);
  assert.ok(voiceEl, "expected a voice <audio> element in index.html");
  const voiceSrc = voiceEl[1];
  assert.match(voiceSrc, /\.faded\.wav$/, `voice src should end in .faded.wav, got "${voiceSrc}"`);

  const outPath = join(dir, voiceSrc);
  assert.equal(existsSync(outPath), true);

  const rawMidDb = rmsDbAt(join(dir, "assets", "voice", "01.wav"), 1.5, 0.005);
  const fadedStartDb = rmsDbAt(outPath, 0, 0.002);
  const fadedMidDb = rmsDbAt(outPath, 1.5, 0.005);
  const fadedEndDb = rmsDbAt(outPath, 2.998, 0.002);

  // The clip's steady middle is unaffected by the edge fade.
  assert.ok(
    Math.abs(fadedMidDb - rawMidDb) < 1,
    `mid-clip level should be ~unchanged: raw ${rawMidDb} dB vs faded ${fadedMidDb} dB`,
  );
  // The very start of the faded clip should read markedly quieter than the
  // steady-state level — the fade-in ramp, not a hard cut at full volume. On
  // the raw (unfaded) source, start and mid are within ~0.5dB of each other,
  // so this margin only passes once a real fade is present.
  assert.ok(
    fadedStartDb < fadedMidDb - 6,
    `start-of-clip level should be well below mid-clip level: start ${fadedStartDb} dB vs mid ${fadedMidDb} dB`,
  );
  // Same check at the tail end, for the fade-out half — a fixed start-window
  // assertion alone would miss a fade-in-only regression.
  assert.ok(
    fadedEndDb < fadedMidDb - 6,
    `end-of-clip level should be well below mid-clip level: end ${fadedEndDb} dB vs mid ${fadedMidDb} dB`,
  );
});

test(
  "a clip shorter than two fade windows still fades, without going silent for its whole length",
  { skip: !HAS_FFMPEG },
  () => {
    const { dir, r } = assembleWith({
      audioMeta: { bgm: null, voices: [{ frame: 1, path: "assets/voice/01.wav" }], sfx: [] },
      beforeAssemble: (projectDir) => {
        mkdirSync(join(projectDir, "assets", "voice"), { recursive: true });
        // Shorter than 2 * VOICE_FADE_SECONDS (0.011s) would ever be in practice,
        // but proves the half-duration clamp rather than assuming it.
        const gen = spawnSync(
          "ffmpeg",
          [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.01",
            join(projectDir, "assets", "voice", "01.wav"),
          ],
          { encoding: "utf8" },
        );
        assert.equal(gen.status, 0, gen.stderr);
      },
    });

    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(dir, "index.html"), "utf8");
    const voiceEl = html.match(/id="el-[^"]*-voice"[\s\S]*?src="([^"]+)"/);
    assert.ok(voiceEl, "expected a voice <audio> element in index.html");
    const outPath = join(dir, voiceEl[1]);
    assert.equal(existsSync(outPath), true);

    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "--", outPath],
      { encoding: "utf8" },
    );
    const outDur = parseFloat(probe.stdout.trim());
    assert.ok(outDur > 0.008, `faded clip should preserve its ~10ms length: ${outDur}s`);

    // Duration alone doesn't prove a fade happened — an untouched raw 10ms clip
    // would pass the length check above too. With the half-duration clamp each 5ms
    // edge fades from/to silence while the midpoint keeps most of its energy:
    // measured on this exact fixture+filter, start/end ≈ -33dB vs mid ≈ -22dB,
    // well outside the ~1dB spread a raw unfaded 10ms tone shows across the same
    // three windows.
    const startDb = rmsDbAt(outPath, 0, 0.002);
    const midDb = rmsDbAt(outPath, 0.004, 0.002);
    const endDb = rmsDbAt(outPath, 0.008, 0.002);
    assert.ok(
      startDb < midDb - 8,
      `start should be well below the clip's own midpoint: start ${startDb} dB vs mid ${midDb} dB`,
    );
    assert.ok(
      endDb < midDb - 8,
      `end should be well below the clip's own midpoint: end ${endDb} dB vs mid ${midDb} dB`,
    );
  },
);
