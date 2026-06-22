#!/usr/bin/env node
// Phase 4c (engine) — deterministic index.html assembly. No subagent.
//
// Owns the mechanical, judgment-free half of finalize (the old
// hyperframes-finalize.md "Step 2"): turning group_spec.json + on-disk state
// into the top-level index.html. The finalize AGENT no longer hand-authors
// clip/audio elements, hand-computes start_s, picks track indices, or eyeballs
// data-duration — those are this script's invariants now. Mirrors the
// captions.mjs group precedent (deterministic engine, agent does only judgment).
//
// index.html is a *standalone* (top-level) composition: root <div> lives
// directly in <body> with NO <template> wrapper (template is for sub-comps).
// Structure is modeled verbatim on proven artifacts — the brex-launch-video
// real pipeline output (scene track 0 + voice track 10) and the style-10-prod
// producer golden test (sub-comp host divs carry data-composition-id matching
// the inner file's id; <audio> carries class="clip"). The canvas size is set
// once by prep (group_spec.width/height — landscape 1920×1080 by default,
// portrait/square when the intent layer requested it); scene workers author and
// self-check against those same dims (agents/hyperframes-scene.md), so the root
// dims here are read from group_spec, not hardcoded.
//
// Track lanes (must not collide — lint flags overlapping_clips_same_track):
//   0      scene sub-comp clips
//   10     per-scene voice <audio>
//   11     BGM <audio>
//   12     captions sub-comp clip
//   20+i   SFX <audio> (one lane each, in group_spec.sfx[] order)
//
// Reads:  ./group_spec.json (Phase 4a) — total_duration_s, font_face_css,
//           bgm_path, sfx[], groups[].scenes[<sid>].{start_s,
//           estimatedDuration_s, voicePath}. On-disk inside --hyperframes:
//           compositions/<sid>.html (existence + root data-duration cross-check),
//           assets/voice/*.wav, assets/bgm.wav, compositions/captions.html,
//           assets/sfx/*.mp3.
// Writes: ./index.html inside the HyperFrames project root (--hyperframes).
//
// Usage:
//   node assemble-index.mjs --group-spec ./group_spec.json --hyperframes . \
//        [--out ./index.html]
//
// Exit 0 = index.html written + summary on stdout.
// Exit 1 = fatal: group_spec unreadable / no scenes / a scene file missing /
//          a scene's root data-duration disagrees with group_spec beyond
//          DUR_EPSILON (voice/SFX/captions global timing assume group_spec —
//          re-dispatch the worker to honor estimatedDuration_s, or re-run prep).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readDims } from "./lib/dimensions.mjs";

// ---------- argv ----------
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
function die(msg) {
  console.error(`✗ assemble-index.mjs: ${msg}`);
  process.exit(1);
}

const groupSpecPath = resolve(flag("group-spec", "./group_spec.json"));
const hyperframesDir = resolve(flag("hyperframes", "."));
const outPath = resolve(flag("out", join(hyperframesDir, "index.html")));

// 1/100s. Scene workers are handed estimatedDuration_s (3-decimal) and must
// echo it on the root; anything past this slack desyncs the precomputed start_s
// / voice / SFX / captions timing, so it's fatal (fix upstream, not here).
const DUR_EPSILON = 0.01;

if (!existsSync(groupSpecPath)) die(`group_spec.json not found at ${groupSpecPath}`);
let groupSpec;
try {
  groupSpec = JSON.parse(readFileSync(groupSpecPath, "utf8"));
} catch (e) {
  die(`group_spec.json parse: ${e.message}`);
}

// Canvas size flows from prep → group_spec.width/height (landscape default for
// pre-dims group_specs). Scene workers author + self-check against these same
// dims, so the index root matches.
const { width: WIDTH, height: HEIGHT } = readDims(groupSpec);

const totalDuration = Number(groupSpec.total_duration_s);
if (!isFinite(totalDuration) || totalDuration <= 0)
  die(`group_spec.total_duration_s missing or non-positive (${groupSpec.total_duration_s})`);

// Flatten play order: groups in array order, scene_ids in array order.
const playOrder = [];
for (const g of groupSpec.groups || []) {
  for (const sid of g.scene_ids || []) {
    playOrder.push({ sid, scene: g.scenes?.[sid] || {} });
  }
}
if (playOrder.length === 0) die("no scenes in group_spec.groups[].scene_ids");

const anomalies = [];

// ---------- helper: pull the root <div>'s data-duration ----------
// The root is the element carrying id="root"; match its full opening tag (same
// shape check-compositions.mjs uses) and read data-duration off THAT tag, not
// some inner clip's. Returns null if the file has no id="root" tag or that tag
// carries no data-duration (check-compositions already gates both — here a null
// just skips the cross-check rather than guessing).
function rootDataDuration(html) {
  const tagM = html.match(/<div\b[^>]*\bid=["']root["'][^>]*>/i);
  if (!tagM) return null;
  const durM = tagM[0].match(/\bdata-duration=["']([\d.]+)["']/);
  return durM ? parseFloat(durM[1]) : null;
}

// ---------- per-scene: existence + duration cross-check ----------
const durMismatches = [];
for (const { sid, scene } of playOrder) {
  const compRel = `compositions/${sid}.html`;
  const compAbs = join(hyperframesDir, compRel);
  if (!existsSync(compAbs)) {
    die(
      `scene file ${compRel} missing — run check-compositions.mjs / re-dispatch worker before assembling`,
    );
  }
  const specDur = Number(scene.estimatedDuration_s);
  if (!isFinite(specDur) || specDur <= 0) {
    die(
      `${sid}: group_spec estimatedDuration_s missing or non-positive (${scene.estimatedDuration_s})`,
    );
  }
  // Guard against blank/partial scene files: a worker that errors or is
  // interrupted mid-write leaves an empty (or markup-less) file that exists but
  // fails at render with "Composition HTML is empty or could not be parsed".
  // Catch it here — before emitting data-composition-src — and re-dispatch.
  const compHtml = readFileSync(compAbs, "utf8");
  if (!compHtml.trim() || !/<\w/.test(compHtml)) {
    die(
      `scene file ${compRel} is empty or has no HTML — the worker for ${sid} wrote a blank/partial file. Re-dispatch that scene worker before assembling.`,
    );
  }
  const rootDur = rootDataDuration(compHtml);
  if (rootDur == null) {
    anomalies.push(
      `${sid}: could not read root data-duration from ${compRel} — skipped duration cross-check`,
    );
  } else if (Math.abs(rootDur - specDur) > DUR_EPSILON) {
    durMismatches.push(`${sid}: worker root data-duration=${rootDur}s but group_spec=${specDur}s`);
  }
}
if (durMismatches.length > 0) {
  die(
    `scene root data-duration disagrees with group_spec (voice / SFX / captions timing assume group_spec):\n  ${durMismatches.join("\n  ")}\n  → re-dispatch the worker to honor estimatedDuration_s, or re-run prep.mjs.`,
  );
}

// ---------- BGM volume: duck under narration if any scene has voice ----------
const hasAnyVoice = playOrder.some(
  ({ scene }) => scene.voicePath && existsSync(join(hyperframesDir, scene.voicePath)),
);
const BGM_VOLUME = hasAnyVoice ? "0.8" : "0.9";

// ---------- build <body> elements in track order ----------
const body = [];
let voiceCount = 0;

for (let i = 0; i < playOrder.length; i++) {
  const { sid, scene } = playOrder[i];
  const start = scene.start_s;
  const dur = scene.estimatedDuration_s;
  // Voice clips share track 10 (single-lane). start_s is prep.mjs's cumulative
  // sum of estimatedDuration_s, so (nextStart - start) IS the scene's own span —
  // this is NOT a semantic change, just a float-exact one: computing dur this way
  // makes the IEEE-754 sum (start + voiceDur) bit-exact equal to nextStart, which
  // avoids spurious StaticGuard "overlaps by 5e-16s" failures when two 3-decimal
  // floats sum off by a ULP (e.g. 1.771 + 3.648 = 5.4190000000000005 ≠ 5.419).
  // Last scene has no successor → fall back to its own duration.
  // (Root cause is the overlap guard lacking a float epsilon; this is the
  // assemble-layer workaround since the skill can't patch core lint.)
  const next = playOrder[i + 1];
  const voiceDur = next ? next.scene.start_s - start : dur;
  // CONTRACT (keep in lockstep with transitions.mjs scene-clip parser): the
  // "HF-SCENE-CLIP <sid>" marker lets transitions.mjs count expected scene clips
  // independently of the <div> attribute formatting and fail loudly if the emit
  // shape below ever drifts out of sync with its regex. Do not rename the marker
  // or collapse the per-attribute line layout without updating transitions.mjs.
  body.push(`      <!-- HF-SCENE-CLIP ${sid} (${start} → ${Number((start + dur).toFixed(3))}) -->`);
  // (track 0) scene sub-comp clip — host data-composition-id MUST equal the
  // inner file's data-composition-id (= sid) or the runtime never finds the
  // timeline. No class="clip" on sub-comp host divs (proven: brex / style-10).
  body.push(
    `      <div`,
    `        id="el-${sid}"`,
    `        data-composition-id="${sid}"`,
    `        data-composition-src="compositions/${sid}.html"`,
    `        data-start="${start}"`,
    `        data-duration="${dur}"`,
    `        data-track-index="0"`,
    `        data-width="${WIDTH}"`,
    `        data-height="${HEIGHT}"`,
    `      ></div>`,
  );
  // (track 10) voice — only when the wav is actually on disk.
  if (scene.voicePath && existsSync(join(hyperframesDir, scene.voicePath))) {
    body.push(
      `      <audio`,
      `        id="el-${sid}-voice"`,
      `        class="clip"`,
      `        src="${scene.voicePath}"`,
      `        data-start="${start}"`,
      `        data-duration="${voiceDur}"`,
      `        data-track-index="10"`,
      `      ></audio>`,
    );
    voiceCount++;
  } else if (scene.voicePath) {
    anomalies.push(`${sid}: voicePath "${scene.voicePath}" not on disk — skipped voice <audio>`);
  }
  body.push("");
}

// (track 11) BGM — Lyria is spawned detached and may not have landed yet, so
// re-check disk here (group_spec / audio_meta only promise the path).
let bgmEmitted = false;
const bgmPath = groupSpec.bgm_path;
if (bgmPath) {
  if (existsSync(join(hyperframesDir, bgmPath))) {
    body.push(
      `      <!-- BGM -->`,
      `      <audio`,
      `        id="el-bgm"`,
      `        class="clip"`,
      `        src="${bgmPath}"`,
      `        data-start="0"`,
      `        data-duration="${totalDuration}"`,
      `        data-track-index="11"`,
      `        data-volume="${BGM_VOLUME}"`,
      `      ></audio>`,
      "",
    );
    bgmEmitted = true;
  } else {
    anomalies.push(`bgm_path "${bgmPath}" not on disk (still rendering?) — skipped BGM <audio>`);
  }
}

// (track 12) captions — captions.mjs html writes this or legally skips; key off existence.
let captionsEmitted = false;
if (existsSync(join(hyperframesDir, "compositions/captions.html"))) {
  body.push(
    `      <!-- captions -->`,
    `      <div`,
    `        id="el-captions"`,
    `        data-composition-id="captions"`,
    `        data-composition-src="compositions/captions.html"`,
    `        data-start="0"`,
    `        data-duration="${totalDuration}"`,
    `        data-track-index="12"`,
    `        data-width="${WIDTH}"`,
    `        data-height="${HEIGHT}"`,
    `      ></div>`,
    "",
  );
  captionsEmitted = true;
}

// (track 20+i) SFX — emitted verbatim from group_spec.sfx[] (already sorted by
// t, file checked against the manifest, duration locked to manifest truth by
// prep). Correct-by-construction; verify-output.mjs sfx re-asserts this against the
// emitted html as the orchestrator's deterministic gate.
const sfx = Array.isArray(groupSpec.sfx) ? groupSpec.sfx : [];
let sfxEmitted = 0;
sfx.forEach((cue, i) => {
  const rel = `assets/sfx/${cue.file}`;
  if (!existsSync(join(hyperframesDir, rel))) {
    anomalies.push(
      `sfx "${cue.file}" not on disk at ${rel} — skipped (prep should have copied it)`,
    );
    return;
  }
  const vol = cue.volume != null ? cue.volume : 0.35;
  if (sfxEmitted === 0) body.push(`      <!-- SFX -->`);
  body.push(
    `      <audio`,
    `        id="el-sfx-${i}"`,
    `        class="clip"`,
    `        src="${rel}"`,
    `        data-start="${cue.t}"`,
    `        data-duration="${cue.duration}"`,
    `        data-track-index="${20 + i}"`,
    `        data-volume="${vol}"`,
    `      ></audio>`,
  );
  sfxEmitted++;
});

// ---------- <head> style: proven base + global brand tokens + optional @font-face ----------
const fontFaceCss = (groupSpec.font_face_css || "").trim();
const brandTokensCss = (groupSpec.brand_tokens_css || "").trim();
const headStyle = [
  "      * {",
  "        margin: 0;",
  "        padding: 0;",
  "        box-sizing: border-box;",
  "      }",
  "      html,",
  "      body {",
  "        margin: 0;",
  `        width: ${WIDTH}px;`,
  `        height: ${HEIGHT}px;`,
  "        overflow: hidden;",
  "        background: #000;",
  "      }",
  "      #root {",
  "        position: relative;",
  `        width: ${WIDTH}px;`,
  `        height: ${HEIGHT}px;`,
  "        overflow: hidden;",
  "      }",
  "      /* Sub-comp slots stretch to fill the root */",
  "      #root > div[data-composition-src] {",
  "        position: absolute;",
  "        inset: 0;",
  "      }",
];
if (brandTokensCss) {
  // Global brand tokens — declared ONCE here. CSS custom properties inherit
  // through the light DOM into every mounted sub-composition, so scenes use
  // var(--*) without re-declaring this block locally. A scene may still override
  // a token on its own #root (cascade) when it needs to (e.g. a dark scene).
  headStyle.push("", "      /* Brand design tokens (from design-system/chunks/tokens.css) */");
  for (const line of brandTokensCss.split("\n")) headStyle.push(`      ${line}`);
}
if (fontFaceCss) {
  headStyle.push("", "      /* Brand fonts (extracted by prep.mjs from design.html) */");
  for (const line of fontFaceCss.split("\n")) headStyle.push(`      ${line}`);
}

// ---------- assemble document ----------
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${WIDTH}, height=${HEIGHT}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
${headStyle.join("\n")}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${totalDuration}"
      data-width="${WIDTH}"
      data-height="${HEIGHT}"
    >
${body.join("\n")}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;

writeFileSync(outPath, html);

// ---------- caption-overrides.json shim ----------
// The captions runtime fetches this file at validate time; absence yields a
// noisy validate ✗ that previously sent finalize on a ~30s debug chase. An
// empty array is a no-op override list — semantically identical to absent —
// but the file existing silences validate.
const captionOverridesPath = join(hyperframesDir, "caption-overrides.json");
let captionOverridesCreated = false;
if (!existsSync(captionOverridesPath)) {
  writeFileSync(captionOverridesPath, "[]\n");
  captionOverridesCreated = true;
}

// ---------- summary ----------
console.log(`✓ wrote ${outPath}`);
console.log(`  scenes (track 0):   ${playOrder.length}`);
console.log(`  voice  (track 10):  ${voiceCount}`);
console.log(`  bgm    (track 11):  ${bgmEmitted ? `yes (vol ${BGM_VOLUME})` : "no"}`);
console.log(`  captions (track 12): ${captionsEmitted ? "yes" : "no"}`);
console.log(
  `  sfx    (track 20+):  ${sfxEmitted}${sfx.length !== sfxEmitted ? ` (${sfx.length - sfxEmitted} skipped)` : ""}`,
);
console.log(`  total duration:     ${totalDuration}s`);
console.log(`  @font-face:         ${fontFaceCss ? `${fontFaceCss.length}B injected` : "none"}`);
if (captionOverridesCreated) console.log(`  caption-overrides.json: created empty [] shim`);
if (anomalies.length) {
  console.log(`\nanomalies (non-fatal):`);
  for (const a of anomalies) console.log(`  - ${a}`);
}
