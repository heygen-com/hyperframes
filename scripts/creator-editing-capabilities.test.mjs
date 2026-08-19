import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const files = {
  router: "skills/hyperframes/SKILL.md",
  keyframes: "skills/hyperframes-keyframes/SKILL.md",
  cli: "skills/hyperframes-cli/SKILL.md",
  audio: "skills/hyperframes-audio/SKILL.md",
  webAudioTransport: "packages/core/src/runtime/webAudioTransport.ts",
  coreClips: "skills/hyperframes-core/references/tracks-and-clips.md",
  generalVideo: "skills/general-video/SKILL.md",
  editingRecipes: "skills/hyperframes-core/references/creator-editing-recipes.md",
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

test("crossfade and volume recipes contain executable opposing envelopes", async () => {
  const recipes = await read(files.editingRecipes);
  const crossfade = recipes.slice(
    recipes.indexOf("## Crossfade"),
    recipes.indexOf("## Volume fades / ducking"),
  );
  requiresAll(
    crossfade,
    [
      /data-track-index="0"[\s\S]*data-track-index="1"/,
      /class="inner"/,
      /gsap\.timeline\(\{\s*paused:\s*true\s*\}\)/,
      /window\.__timelines/,
      /autoAlpha|opacity/,
      /<audio[\s\S]*<audio/,
      /data-automation='/,
    ],
    "crossfade recipe",
  );
  const crossfadeAutomation = [...crossfade.matchAll(/data-automation='([^']+)'/g)];
  assert.equal(crossfadeAutomation.length, 2);
  for (const match of crossfadeAutomation) JSON.parse(match[1]);
  const volume = recipes.slice(
    recipes.indexOf("## Volume fades / ducking"),
    recipes.indexOf("## Audio alignment"),
  );
  requiresAll(
    volume,
    [/fade-in/i, /fade-out/i, /duck down/i, /hold/i, /duck up/i, /data-automation='/],
    "volume recipe",
  );
  JSON.parse(volume.match(/data-automation='([^']+)'/)?.[1] ?? "");
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

// fallow-ignore-next-line complexity
test("every temporal source-range recipe includes matching audio markup", async () => {
  const recipes = await read(files.editingRecipes);
  for (const name of [
    "Hard cut",
    "Trim in/out",
    "Split / splice",
    "Duplicate / reuse same source",
    "Reorder",
  ]) {
    const start = recipes.indexOf(`## ${name}`);
    const next = recipes.indexOf("## ", start + 3);
    const section = recipes.slice(start, next < 0 ? recipes.length : next);
    const videos = [...section.matchAll(/<video[\s\S]*?<\/video>/g)].map((m) => m[0]);
    const audios = [...section.matchAll(/<audio[\s\S]*?<\/audio>/g)].map((m) => m[0]);
    assert.ok(
      videos.length > 0 && audios.length >= videos.length,
      `${name}: matching audio missing`,
    );
    for (const video of videos) {
      for (const attr of ["src", "data-start", "data-duration", "data-media-start"]) {
        const value = video.match(new RegExp(`${attr}="([^"]+)"`))?.[1];
        assert.ok(
          value && audios.some((audio) => audio.includes(`${attr}="${value}"`)),
          `${name}: audio mismatch ${attr}`,
        );
      }
    }
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
