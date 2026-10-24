import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const files = {
  entry: "skills/hyperframes/SKILL.md",
  format: "skills/hyperframes/references/format.md",
  motion: "skills/hyperframes/references/motion.md",
  cli: "skills/hyperframes-cli/SKILL.md",
  mixing: "skills/media-use/references/mixing.md",
  webAudioTransport: "packages/core/src/runtime/webAudioTransport.ts",
  runtimeMedia: "packages/core/src/runtime/media.ts",
  runtimeInit: "packages/core/src/runtime/init.ts",
  timingNumbers: "packages/core/src/runtime/playbackRate.ts",
  clipTree: "packages/core/src/runtime/clipTree.ts",
  timeline: "packages/core/src/runtime/timeline.ts",
  timingCompiler: "packages/core/src/compiler/timingCompiler.ts",
  mediaWindow: "packages/engine/src/services/mediaTimelineWindow.ts",
  videoExtractor: "packages/engine/src/services/videoFrameExtractor.ts",
  audioMixer: "packages/engine/src/services/audioMixer.ts",
  webAudioTransportTest: "packages/core/src/runtime/webAudioTransport.test.ts",
  audioFxTest: "packages/core/src/runtime/audioFx.test.ts",
};

function requiresAll(text, patterns, surface) {
  for (const pattern of patterns) {
    assert.match(text, pattern, `${surface} is missing ${pattern}`);
  }
}

test("the entry skill sends motion edits to the motion reference and media to media-use", async () => {
  const entry = await read(files.entry);
  assert.match(
    entry,
    /\| Motion: [^\n]*punch-ins, speed, holds \| `references\/motion\.md` \|/,
    "the References table routes punch-ins, speed changes and holds",
  );
  assert.match(entry, /Any media[\s\S]{0,200}`\/media-use`/);
});

test("the motion reference states truthful creator capabilities", async () => {
  const motion = await read(files.motion);
  requiresAll(
    motion,
    [
      /Punch-in, zoom, pan, Ken Burns, reframe[^\n]*wrapper inside the clip, never on the timed media element/,
      /Crop or mask reveal[^\n]*`clip-path` or a mask on an inner wrapper; source time is untouched/,
      /Constant speed change[^\n]*`data-playback-rate`/,
      /Speed ramp[^\n]{0,80}`rate` lane in `data-automation`/,
      /Speed ramp[^\n]{0,220}overrides the constant rate/,
      /freeze mid-source needs a still exported first/,
      /match cut/i,
    ],
    files.motion,
  );
  assert.doesNotMatch(motion, /keyframe(?:d|ing)?\s+(?:the\s+)?data-playback-rate/i);
});

test("CLI sends `hyperframes keyframes` to the motion reference", async () => {
  const cli = await read(files.cli);
  assert.match(cli, /Read the row before running its command/);
  assert.match(cli, /\| `keyframes` \| `\.\.\/hyperframes\/references\/motion\.md`/);
});

test("the mixing reference owns placed-track fades, automation, ducking, and effects", async () => {
  const mixing = await read(files.mixing);
  requiresAll(
    mixing,
    [
      /`data-fade-in`, `data-fade-out`/,
      /crossfade/i,
      /Track gain/,
      /Duck the bed/,
      /data-automation/,
      /gain.*peaking.*compressor.*limiter.*gate.*saturate.*delay.*reverb.*chorus.*phaser.*bitcrush/is,
      /data-playback-rate/,
      /`rate` \(a speed ramp, 0\.1–10, overrides `data-playback-rate`\)/,
    ],
    files.mixing,
  );
});

test("WebAudio scheduling combines per-element and global transport playback rates", async () => {
  const webAudioTransport = await read(files.webAudioTransport);
  assert.match(
    webAudioTransport,
    /mediaRate[\s\S]{0,120}readElementPlaybackRate\(el\)[\s\S]{0,160}sourceRate\s*=\s*safeRate\s*\*\s*mediaRate/i,
  );
});

test("source trims and a video's own sound stay on the clip", async () => {
  const [entry, format] = await Promise.all([read(files.entry), read(files.format)]);
  assert.match(format, /`data-media-start`[^\n]*\(a trim\)/);
  assert.match(format, /Prefer one `<video data-has-audio="true">`/);
  assert.match(
    entry,
    /A `<video>` keeps its sound with `data-has-audio="true"`, else it is `muted`; music, voice, replacement sound and J\/L cuts are a separate `<audio>`\./,
  );
});

test("every preview reader shares the non-negative media-start helper", async () => {
  for (const path of [
    files.runtimeMedia,
    files.runtimeInit,
    "packages/core/src/runtime/clipTree.ts",
    "packages/core/src/runtime/timeline.ts",
    "packages/core/src/runtime/startResolver.ts",
  ]) {
    const source = await read(path);
    assert.match(
      source,
      /readElementPlaybackStart|readMediaStart|resolveNaturalMediaTimelineDuration/,
    );
  }
});

test("crossfade and ducking guidance carries executable envelopes", async () => {
  const mixing = await read(files.mixing);
  assert.match(
    mixing,
    /A crossfade is two clips on different tracks that overlap, each with a fade\./,
  );
  const lanes = JSON.parse(mixing.match(/data-automation='([^']+)'/)?.[1] ?? "");
  assert.equal(lanes.lanes[0].target, "volume");
  requiresAll(
    mixing,
    [/full level before the voice/, /down to about 0\.3–0\.4 while anyone speaks/, /back up after/],
    "ducking guidance",
  );
});

test("natural media duration is rate-scaled across every preview surface", async () => {
  for (const path of [
    files.runtimeInit,
    "packages/core/src/runtime/clipTree.ts",
    "packages/core/src/runtime/timeline.ts",
  ]) {
    assert.match(await read(path), /resolveNaturalMediaTimelineDuration/);
  }
});

test("all literal timing readers use one strict finite-number contract", async () => {
  assert.match(await read(files.timingNumbers), /parseStrictFiniteTimingNumber/);
  for (const path of [
    files.clipTree,
    files.timeline,
    files.runtimeInit,
    files.timingCompiler,
    files.mediaWindow,
    files.videoExtractor,
    files.audioMixer,
  ]) {
    assert.match(
      await read(path),
      /parseStrictFiniteTimingNumber/,
      `${path} bypasses strict timing`,
    );
  }
});

test("attribute mocks dispatch by name instead of answering every attribute", async () => {
  const webAudio = await read(files.webAudioTransportTest);
  const audioFx = await read(files.audioFxTest);
  assert.doesNotMatch(webAudio, /getAttribute:\s*\(\)\s*=>\s*(?:"1"|src)/);
  assert.doesNotMatch(audioFx, /getAttribute:\s*\(\)\s*=>\s*"\{not json"/);
  assert.match(webAudio, /name\s*===\s*"data-playback-rate"/);
  assert.match(webAudio, /name\s*===\s*"src"/);
  assert.match(audioFx, /name\s*===\s*HF_AUDIO_FX_ATTR/);
});
