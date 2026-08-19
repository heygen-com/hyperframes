#!/usr/bin/env node
/**
 * Apply a voiceover carve to a composition, from the command line.
 *
 * The carve is an analysis: it listens to a voice track, finds the bands it
 * occupies, and writes a chain of dips into the music bed plus a level match. In
 * Studio a panel runs it. This is the same analysis for an agent that has no
 * panel to click — identical functions from `@hyperframes/core`, identical
 * output, so a composition carved here and one carved in Studio are the same
 * three attributes.
 *
 *   node carve.mjs --comp index.html
 *   node carve.mjs --comp index.html --bed music-bed --voice narration \
 *        --voice interview-guest --strength 0.45
 *
 * With no --bed/--voice it works out the tracks itself: the bed, and every voice
 * playing over it. `--voice` may be repeated to name them instead. Every named
 * voice is analysed together, so a bed running under a narrator and an answer makes
 * room for both.
 *
 * Needs `ffmpeg` on PATH (to decode the audio) and `@hyperframes/core` resolvable
 * from the composition's project (`npm i -D @hyperframes/core`) — the CLI bundles
 * core inline rather than shipping it as a package, so it cannot be borrowed from
 * there.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Sample rate the analysis runs at. Matches Studio's own decode rate, so the
 *  bands and envelopes come out the same either way. */
const SAMPLE_RATE = 48000;

const usage = `carve.mjs --comp <file.html> [--bed <elementId>] [--voice <elementId> ...]
              [--strength 0..1] [--dry-run] [--core <dir>]

  --bed       id of the music track that gets carved   (detected if omitted)
  --voice     id of a voice to make room for; repeatable (detected if omitted)
  --strength  how hard to carve, 0..1 (default 0.25)
  --dry-run   report what it would write, touch nothing
  --core      directory to resolve @hyperframes/core from (default: the comp's)`;

function parseArgs(argv) {
  const args = { strength: 0.25, dryRun: false, voices: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) fail(`${flag} needs a value`);
      i += 1;
      return value;
    };
    if (flag === "--comp") args.comp = next();
    else if (flag === "--bed") args.bed = next();
    else if (flag === "--voice") args.voices.push(next());
    else if (flag === "--strength") args.strength = Number(next());
    else if (flag === "--core") args.core = next();
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "-h" || flag === "--help") fail(usage, 0);
    else fail(`unknown flag: ${flag}\n\n${usage}`);
  }
  if (!args.comp) fail(`--comp is required\n\n${usage}`);
  if (!Number.isFinite(args.strength) || args.strength < 0 || args.strength > 1) {
    fail("--strength must be a number from 0 to 1");
  }
  return args;
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/**
 * Load the carve analysis out of `@hyperframes/core`.
 *
 * Resolved from the project rather than from this script, which lives wherever
 * the skill was installed — a sibling of the composition is what has the
 * dependency.
 */
async function loadCore(fromDir) {
  const require = createRequire(pathToFileURL(resolve(fromDir, "package.json")));
  const load = (subpath) => {
    const file = require.resolve(`@hyperframes/core/${subpath}`);
    return import(pathToFileURL(file).href);
  };
  try {
    return {
      carve: await load("audio-carve"),
      fx: await load("audio-fx"),
    };
  } catch (error) {
    fail(
      `cannot resolve @hyperframes/core from ${fromDir}\n` +
        `  install or update it:  npm i -D @hyperframes/core\n` +
        `  (the audio-carve export needs a version that ships the carve analysis)\n` +
        `  or point at one:   --core <dir containing node_modules/@hyperframes/core>\n` +
        `  (${error.message})`,
    );
  }
}

/** Mono float PCM for one media file, via ffmpeg. */
function decode(path) {
  let raw;
  try {
    raw = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        "-f",
        "f32le",
        "-",
      ],
      { maxBuffer: 1 << 30 },
    );
  } catch (error) {
    fail(`could not decode ${path}\n  ${error.message.split("\n")[0]}`);
  }
  if (raw.length === 0) fail(`no audio in ${path}`);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

const attrOf = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1] ?? null;

const unescapeAttr = (value) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const escapeAttr = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Every media element with a src, as {id, tag, kind}. */
function mediaElements(html) {
  const found = [];
  for (const match of html.matchAll(/<(audio|video)\b[^>]*>/gi)) {
    const tag = match[0];
    // `\sid=` and not `id=`: `data-hf-id` would match first.
    const id = tag.match(/\sid="([^"]+)"/)?.[1];
    if (id && attrOf(tag, "src")) found.push({ id, tag, kind: match[1].toLowerCase() });
  }
  return found;
}

/**
 * Work out which track is the bed and which tracks are its voices.
 *
 * Names first, because they are what the author already told us and the answer is
 * explainable: a track whose id or filename looks like music is the bed, ones that
 * look like speech are voices, SFX-shaped names are neither. `classifyAudioName`
 * comes from core so Studio's own picker and this cannot disagree.
 *
 * EVERY voice over the bed, not one of them. A bed usually runs under a whole
 * sequence, and they are analysed together — so there is nothing to disambiguate,
 * which is why this no longer refuses when several tracks look like speech.
 *
 * Only tracks that actually play while the bed does: one somewhere else on the
 * timeline cannot mask it. It still refuses when it cannot find a bed at all, or
 * finds no voice to make room for.
 */
function detectTracks(html, given, classify, overlaps) {
  const all = mediaElements(html);
  const kindOf = (el) => classify(el.id, unescapeAttr(attrOf(el.tag, "src") ?? ""));
  const spanOf = (el) => {
    const raw = attrOf(el.tag, "data-duration");
    const n = raw === null ? Number.NaN : Number(raw);
    return {
      start: startOf(el.tag),
      duration: Number.isFinite(n) ? n : null,
    };
  };
  const pick = (id, what) => {
    const found = all.find((el) => el.id === id);
    if (!found) fail(`no <audio>/<video> with id="${id}" in the composition`);
    return { ...found, why: `--${what}` };
  };

  let bed = given.bed ? pick(given.bed, "bed") : null;
  const named = given.voices.map((id) => pick(id, "voice"));

  if (!bed) {
    const others = all.filter((el) => !named.some((v) => v.id === el.id));
    const music = others.filter((el) => kindOf(el) === "music");
    if (music.length === 1) bed = { ...music[0], why: "name looks like music" };
    else if (music.length > 1) {
      fail(
        `several tracks look like music (${music.map((el) => el.id).join(", ")}) — name one with --bed`,
      );
    } else if (others.length === 1) {
      bed = { ...others[0], why: "only track left" };
    } else {
      fail(
        `cannot tell which track is the music bed\n` +
          `  media in the composition: ${all.map((el) => el.id).join(", ") || "none"}\n` +
          `  name it with --bed`,
      );
    }
  }

  const bedSpan = spanOf(bed);
  const overlapping = (el) => overlaps(bedSpan, spanOf(el));
  const plausible = all
    .filter((el) => el.id !== bed.id && kindOf(el) !== "music" && kindOf(el) !== "sfx")
    .filter(overlapping);
  // A voiceover is normally its own <audio>. Video counts only when no audio track
  // is left to be the voice — a talking-head recut — because otherwise every B-roll
  // clip in the composition reads as somebody talking.
  const spoken = plausible.filter((el) => el.kind === "audio");
  const pool = spoken.length > 0 ? spoken : plausible;
  const voices = named.length
    ? named
    : pool.map((el) => ({
        ...el,
        why: kindOf(el) === "voice" ? "name looks like a voice" : "plays over the bed",
      }));

  const usable = voices.filter((el) => attrOf(el.tag, "src"));
  if (usable.length === 0) {
    fail(
      `no voice to make room for on ${bed.id}\n` +
        `  media in the composition: ${all.map((el) => el.id).join(", ") || "none"}\n` +
        `  name one with --voice`,
    );
  }
  return { bed, voices: usable };
}

const startOf = (tag) => {
  const raw = Number(attrOf(tag, "data-start"));
  return Number.isFinite(raw) ? raw : 0;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const compPath = resolve(args.comp);
  const compDir = dirname(compPath);
  const { carve: carveApi, fx: fxApi } = await loadCore(args.core ? resolve(args.core) : compDir);

  const html = readFileSync(compPath, "utf-8");
  const { bed: bedEl, voices } = detectTracks(
    html,
    args,
    carveApi.classifyAudioName,
    carveApi.clipsOverlap,
  );
  const bedTag = bedEl.tag;
  const bedSrc = attrOf(bedTag, "src");
  process.stdout.write(
    `bed    ${bedEl.id} (${bedEl.why})\n` +
      voices.map((v) => `voice  ${v.id} (${v.why})`).join("\n") +
      "\n",
  );

  const profile = carveApi.carveProfile(args.strength);
  // Every voice summed onto the BED's clock before anything is measured. One
  // question — where and when is speech masking this bed — with one answer, even
  // when the answer comes from several people at different times.
  const voice = carveApi.mixCarveSources(
    voices.map((v) => ({
      samples: decode(resolve(compDir, unescapeAttr(attrOf(v.tag, "src")))),
      offsetSeconds: startOf(v.tag) - startOf(bedTag),
    })),
    SAMPLE_RATE,
  );
  if (voice.length === 0) fail("the voices do not overlap the bed, so there is nothing to carve");
  const bands = carveApi.analyseCarveBands(voice, SAMPLE_RATE, profile);

  // The level half of the carve needs both sides: "how far over the speech is this
  // bed" cannot be answered by listening to one of them. No offset — the mix is
  // already on the bed's clock.
  const bed = profile.duckDb > 0 ? decode(resolve(compDir, unescapeAttr(bedSrc))) : null;
  const duck = bed ? carveApi.analyseCarveDuck(voice, bed, SAMPLE_RATE, profile, 0) : [];

  // Anything the author built by hand survives a carve; only the previous
  // carve's own nodes are replaced. That is what `fromCarve` is for.
  const existingChain = attrOf(bedTag, "data-fx-chain");
  const existingNodes = existingChain
    ? fxApi.parseAudioFxChain(unescapeAttr(existingChain)).nodes
    : [];
  const kept = existingNodes.filter((n) => !n.fromCarve);
  // Lanes belonging to the carve being replaced, addressed by the ids the OLD
  // nodes had. Taken before anything is minted: those ids are freed by the
  // replacement and a new node can be handed one of them, so reading them off the
  // new chain would keep exactly the stale lanes it is supposed to drop.
  const stalePrefixes = existingNodes.filter((n) => n.fromCarve && n.id).map((n) => `fx.${n.id}.`);

  let claimed = { version: 1, nodes: kept };
  const mint = (node) => {
    const withId = { ...node, id: fxApi.mintAudioFxNodeId(claimed), fromCarve: true };
    claimed = { version: 1, nodes: [...claimed.nodes, withId] };
    return withId;
  };
  const bandNodes = bands.map((band) => mint(carveApi.carveBandsToChain([band]).nodes[0]));

  const duckNode =
    duck.length > 0
      ? mint({
          type: "gain",
          enabled: true,
          params: {
            ...fxApi.defaultAudioFxParams("gain"),
            gain: 0,
          },
        })
      : null;
  const chain = {
    version: 1,
    nodes: [...bandNodes, ...(duckNode ? [duckNode] : []), ...kept],
  };

  /**
   * One carve envelope as a lane on the BED's clock.
   *
   * Nothing to shift: the voices were summed onto that clock before the analysis
   * ran. A lane does hold its first value backwards to the start of its clip, so an
   * envelope that begins later needs an explicit "no cut" at zero or the bed starts
   * out ducked.
   */
  const laneFor = (id, points) => {
    const timed = points
      .map((p) => ({ t: Number(p.t.toFixed(3)), v: p.v }))
      .filter((p) => p.t >= 0);
    if ((timed[0]?.t ?? 0) > 0) timed.unshift({ t: 0, v: 0 });
    return timed.length > 1 ? [{ target: `fx.${id}.gain`, points: timed }] : [];
  };

  // Every carve follows the speech: a fixed depth thins the bed through every pause.
  const carvedLanes = [
    ...carveApi
      .analyseCarveDynamics(voice, SAMPLE_RATE, bands)
      .flatMap((dyn, i) => (bandNodes[i]?.id ? laneFor(bandNodes[i].id, dyn.points) : [])),
    ...(duckNode?.id && duck.length > 0 ? laneFor(duckNode.id, duck) : []),
  ];

  // Hand-drawn lanes are kept the same way hand-built nodes are: by dropping only
  // the ones that addressed the previous carve's nodes.
  const existingAutomation = attrOf(bedTag, "data-automation");
  const carriedLanes = existingAutomation
    ? (JSON.parse(unescapeAttr(existingAutomation)).lanes ?? []).filter(
        (lane) => !stalePrefixes.some((prefix) => String(lane.target).startsWith(prefix)),
      )
    : [];
  const lanes = [...carriedLanes, ...carvedLanes];

  const settings = { enabled: true, sources: voices.map((v) => v.id), strength: args.strength };
  const written =
    ` data-fx-carve="${escapeAttr(JSON.stringify(settings))}"` +
    ` data-fx-chain="${escapeAttr(fxApi.serializeAudioFxChain(chain))}"` +
    (lanes.length > 0
      ? ` data-automation="${escapeAttr(JSON.stringify({ version: 1, lanes }))}"`
      : "");

  process.stdout.write(
    `carve  strength ${args.strength}, ${voices.length} voice${voices.length === 1 ? "" : "s"}\n` +
      `bands  ${bands.map((b) => `${b.freq}Hz ${b.gainDb}dB q${b.q}`).join(", ")}\n` +
      `level  ${
        duckNode
          ? `${duck.length}-point envelope, floor ${Math.min(...duck.map((p) => p.v))} dB`
          : "no level match at this strength"
      }\n` +
      `lanes  ${carvedLanes.length} carve${carriedLanes.length ? ` + ${carriedLanes.length} kept` : ""}\n`,
  );
  if (args.dryRun) {
    process.stdout.write("dry run: nothing written\n");
    return;
  }

  let stripped = bedTag;
  for (const attr of ["data-fx-carve", "data-fx-chain", "data-automation"]) {
    stripped = stripped.replace(new RegExp(`\\s${attr}="[^"]*"`, "i"), "");
  }
  // Inserted before the tag's own closing ">", which is the only place they can
  // go: `stripped` is the opening tag alone, so appending would land outside it.
  const nextTag = stripped.replace(/\/?>$/, (close) => `${written}${close}`);
  if (nextTag === stripped) fail("attribute write produced no change — refusing to save");
  writeFileSync(compPath, html.replace(bedTag, nextTag));
  process.stdout.write(`wrote ${args.comp} (id="${bedEl.id}")\n`);
}

await main();
