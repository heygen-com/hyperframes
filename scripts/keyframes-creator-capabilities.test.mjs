import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const files = {
  router: "skills/hyperframes/SKILL.md",
  keyframes: "skills/hyperframes-keyframes/SKILL.md",
  cli: "skills/hyperframes-cli/SKILL.md",
  audio: "skills/hyperframes-audio/SKILL.md",
  remotionMedia: "skills/remotion-to-hyperframes/references/media.md",
  remotionMap: "skills/remotion-to-hyperframes/references/api-map.md",
  webAudioTransport: "packages/core/src/runtime/webAudioTransport.ts",
};

function requiresAll(text, patterns, surface) {
  for (const pattern of patterns) {
    assert.match(text, pattern, `${surface} is missing ${pattern}`);
  }
}

test("router loads the owning skills for creator picture and sound edits", async () => {
  const router = await read(files.router);
  requiresAll(
    router,
    [
      /cut this footage/i,
      /trim[\s\S]{0,80}splice[\s\S]{0,80}reorder|trim[\s\S]{0,80}reorder[\s\S]{0,80}splice/i,
      /source range/i,
      /punch[- ]in.*punch[- ]out/i,
      /multi-state zoom|smooth.*zoom.*reframe/i,
      /Ken Burns/i,
      /camera move/i,
      /match cut/i,
      /whip pan/i,
      /fade.*crossfade/i,
      /duck.*automation.*effects|automation.*duck.*effects/i,
      /picture and sound|video and audio/i,
    ],
    files.router,
  );
  assert.match(router, /cut.*trim.*splice.*reorder[\s\S]{0,500}hyperframes-core/i);
  assert.match(
    router,
    /zoom.*punch.*reframe.*Ken Burns.*camera move[\s\S]{0,500}hyperframes-keyframes/i,
  );
  assert.match(
    router,
    /match cut.*whip pan[\s\S]{0,500}hyperframes-animation[\s\S]{0,300}hyperframes-keyframes[\s\S]{0,300}hyperframes-registry/i,
  );
  assert.match(router, /fade.*crossfade.*gain.*duck[\s\S]{0,700}hyperframes-audio/i);
  assert.match(
    router,
    /picture and sound[\s\S]{0,700}hyperframes-core[\s\S]{0,300}hyperframes-audio/i,
  );
  assert.match(router, /media-use[\s\S]{0,180}sourc|sourc[\s\S]{0,180}media-use/i);
});

test("keyframes states truthful creator capabilities and ownership boundaries", async () => {
  const keyframes = await read(files.keyframes);
  requiresAll(
    keyframes,
    [
      /hard cut/i,
      /trim[\s\S]{0,80}splice[\s\S]{0,80}reorder|trim[\s\S]{0,80}reorder[\s\S]{0,80}splice/i,
      /punch[- ]in.*punch[- ]out/i,
      /multi-state zoom|multiple zoom.*reframe states/i,
      /Ken Burns/i,
      /camera move/i,
      /match cut/i,
      /whip pan/i,
      /data-start/,
      /data-duration/,
      /data-media-start/,
      /hyperframes-core/,
      /hyperframes-audio/,
    ],
    files.keyframes,
  );
  assert.match(
    keyframes,
    /source[\s\S]{0,80}cut[\s\S]{0,80}trim[\s\S]{0,80}reorder[\s\S]{0,500}hyperframes-core/i,
  );
  assert.match(keyframes, /non-timed|non-clip/);
  assert.match(keyframes, /wrapper inside the clip|inner.*wrapper/i);
  assert.match(keyframes, /speed ramps?[\s\S]{0,300}(not supported|preprocess)/i);
  assert.match(keyframes, /arbitrary mid-source freeze[\s\S]{0,300}(not supported|preprocess)/i);
  assert.doesNotMatch(keyframes, /keyframe(?:d|ing)?\s+(?:the\s+)?data-playback-rate/i);
});

test("CLI requires domain skills before authoring or diagnosing creator edits", async () => {
  const cli = await read(files.cli);
  assert.match(
    cli,
    /before[\s\S]{0,120}(zoom|punch-in)[\s\S]{0,180}(reframe|camera)[\s\S]{0,180}keyframe[\s\S]{0,220}read `?\/hyperframes-keyframes/i,
  );
  assert.match(cli, /before `?hyperframes keyframes`?[\s\S]{0,180}read `?\/hyperframes-keyframes/i);
  assert.match(cli, /cut.*trim.*splice.*source timing[\s\S]{0,250}hyperframes-core/i);
  assert.match(
    cli,
    /fade[\s\S]{0,100}crossfade[\s\S]{0,100}volume automation[\s\S]{0,100}carve[\s\S]{0,100}FX[\s\S]{0,300}hyperframes-audio/i,
  );
});

test("audio skill owns placed-track fades, automation, ducking, and effects", async () => {
  const audio = await read(files.audio);
  requiresAll(
    audio,
    [
      /fade[- ]in.*fade[- ]out/i,
      /crossfade/i,
      /track gain|track volume/i,
      /duck/i,
      /data-automation/,
      /gain.*EQ.*compressor.*limiter.*gate.*saturat.*delay.*reverb.*chorus.*phaser.*bitcrush/is,
      /clip timing.*hyperframes-core|hyperframes-core.*clip timing/is,
      /sourcing.*media-use|media-use.*sourcing/is,
    ],
    files.audio,
  );
  assert.match(audio, /constant.*playback rate|data-playback-rate/i);
  assert.match(audio, /speed ramps?[\s\S]{0,220}(not supported|preprocess)/i);
});

test("Remotion media mapping uses the canonical trim and render-safe constant-rate contract", async () => {
  const [media, apiMap] = await Promise.all([read(files.remotionMedia), read(files.remotionMap)]);
  const combined = `${media}\n${apiMap}`;
  assert.match(combined, /data-media-start/);
  assert.match(combined, /data-playback-rate/);
  assert.match(combined, /constant.*playback rate|playback rate.*constant/i);
  assert.match(combined, /volume automation|data-automation/i);
  assert.doesNotMatch(combined, /data-trim-start|data-trim-end/);
});

test("WebAudio scheduling combines per-element and global transport playback rates", async () => {
  const webAudioTransport = await read(files.webAudioTransport);
  assert.match(
    webAudioTransport,
    /mediaRate[\s\S]{0,120}readElementPlaybackRate\(el\)[\s\S]{0,160}sourceRate\s*=\s*safeRate\s*\*\s*mediaRate/i,
  );
});

test("keyframes routes visual crop and mask handoffs without claiming temporal source edits", async () => {
  const keyframes = await read(files.keyframes);
  requiresAll(
    keyframes,
    [
      /interpolat(?:e|ed|ing)[\s\S]{0,100}(clip-path|mask)[\s\S]{0,100}(crop|reframe)/i,
      /directional wipe cut/i,
      /iris[\s\S]{0,40}reveal cut|reveal[\s\S]{0,40}iris cut/i,
      /split-screen handoff/i,
      /polygon[\s\S]{0,50}mask transition|mask[\s\S]{0,50}polygon transition/i,
      /visual transition[\s\S]{0,120}(not|isn't|is not)[\s\S]{0,80}(temporal|source)[\s\S]{0,80}(trim|splice)/i,
      /hyperframes-core[\s\S]{0,160}(timeline|clip timing)/i,
    ],
    files.keyframes,
  );
});
