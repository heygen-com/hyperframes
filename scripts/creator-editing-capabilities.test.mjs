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
  coreClips: "skills/hyperframes-core/references/tracks-and-clips.md",
  generalVideo: "skills/general-video/SKILL.md",
  editingRecipes: "skills/hyperframes-core/references/creator-editing-recipes.md",
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

test("core and general-video author temporal edits as duplicated source-range clips", async () => {
  const [coreClips, generalVideo, router, keyframes] = await Promise.all([
    read(files.coreClips),
    read(files.generalVideo),
    read(files.router),
    read(files.keyframes),
  ]);
  for (const [surface, text] of [
    [files.coreClips, coreClips],
    [files.generalVideo, generalVideo],
  ]) {
    requiresAll(
      text,
      [
        /duplicate[\s\S]{0,120}(same|one)[\s\S]{0,80}(video|media) source/i,
        /data-media-start[\s\S]{0,120}data-duration/i,
        /data-start/,
        /hard cut[\s\S]{0,100}trim[\s\S]{0,100}splice[\s\S]{0,100}reorder/i,
        /separate(?:ly)? authored audio[\s\S]{0,180}(identical|same)[\s\S]{0,100}(range|timing)/i,
      ],
      surface,
    );
  }
  assert.match(router, /cut this footage[\s\S]{0,300}hyperframes-core/i);
  requiresAll(keyframes, [/zoom/i, /punch/i, /pan/i, /crop|mask|clip-path/i], files.keyframes);
  assert.match(keyframes, /inner[\s\S]{0,80}wrapper/i);
  assert.match(keyframes, /not a temporal source trim or[\s\S]{0,40}splice/i);
});

test("creator editing recipes are copyable, owned, mathematical, and limitation-safe", async () => {
  const recipes = await read(files.editingRecipes).catch(() => "");
  const recipeNames = [
    "Hard cut",
    "Trim in/out",
    "Split / splice",
    "Duplicate / reuse same source",
    "Reorder",
    "Freeze / hold",
    "Constant speed / slow motion",
    "Zoom / punch",
    "Pan / Ken Burns",
    "Crop / reframe",
    "Clip-path wipe / reveal / mask / split-screen",
    "Crossfade",
    "Volume fades / ducking",
    "Audio alignment",
  ];
  for (let index = 0; index < recipeNames.length; index += 1) {
    const start = recipes.indexOf(`## ${recipeNames[index]}`);
    const next =
      index + 1 < recipeNames.length
        ? recipes.indexOf(`## ${recipeNames[index + 1]}`)
        : recipes.length;
    assert.ok(start >= 0, `missing recipe: ${recipeNames[index]}`);
    const section = recipes.slice(start, next);
    requiresAll(
      section,
      [
        /```(?:html|js)/,
        /Timeline math:/i,
        /Source math:/i,
        /Audio follows:/i,
        /Owner:/i,
        /Limit:/i,
      ],
      recipeNames[index],
    );
  }
  requiresAll(
    recipes,
    [
      /data-start/,
      /data-duration/,
      /data-media-start/,
      /data-playback-rate/,
      /consumed source\s*=\s*timeline duration\s*[×*]\s*rate/i,
      /natural timeline duration\s*=\s*remaining source\s*\/\s*rate/i,
      /separate audio track/i,
      /final-source[\s\S]{0,100}subcomp[\s\S]{0,100}visual pose/i,
      /arbitrary mid-source[\s\S]{0,120}preprocess/i,
      /distinct tracks[\s\S]{0,120}overlap[\s\S]{0,120}opposing/i,
      /same-track overlap[\s\S]{0,80}invalid/i,
      /inner wrapper[\s\S]{0,100}not[\s\S]{0,50}(clip element|timed clip)/i,
      /source cuts[\s\S]{0,80}hyperframes-core/i,
    ],
    files.editingRecipes,
  );
  const [core, general] = await Promise.all([
    read("skills/hyperframes-core/SKILL.md"),
    read(files.generalVideo),
  ]);
  assert.match(core, /creator-editing-recipes\.md/);
  assert.match(general, /creator-editing-recipes\.md/);
  assert.doesNotMatch(recipes, /data-(?:media-end|source-end|trim-start|trim-end)/);
});
