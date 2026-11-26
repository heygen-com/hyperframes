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
 * Needs `ffmpeg` on PATH (to decode the audio). The analysis ships beside this
 * script (`lib/audio-carve.mjs`, generated from core), so nothing in the
 * composition's project is loaded.
 */

import "../../scripts/lib/windows-exe-search.mjs";
import { execFileSync } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  fchmodSync,
  lstatSync,
  openSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import * as carveApi from "./lib/audio-carve.mjs";
import { isMainModule } from "./lib/main-module.mjs";
import {
  ACCEPTED_CONTAINERS,
  isIndirectFormat,
  pinnedInput,
  probeFormat,
} from "./lib/media-input.mjs";
import { isPlainProjectPath, projectPath } from "./lib/project-path.mjs";
import { assertLiteralMediaPath } from "../../scripts/lib/literal-media-input.mjs";
import { replaceFileWith } from "../../scripts/lib/link-safe-write.mjs";
import { readRegularFile } from "../../scripts/lib/recipe-store.mjs";
import { terminalLines, terminalText as shown } from "../../scripts/lib/terminal-text.mjs";

/** Sample rate the analysis runs at. Matches Studio's own decode rate, so the
 *  bands and envelopes come out the same either way. */
const SAMPLE_RATE = 48000;

/** Default carve strength. 0.25 kept the bed present but still fighting the voice. */
export const DEFAULT_STRENGTH = 0.8;

const usage = `carve.mjs --comp <file.html> [--bed <elementId>] [--voice <elementId> ...]
              [--strength 0..1] [--dry-run]

  --bed       id of the music track that gets carved   (detected if omitted)
  --voice     id of a voice to make room for; repeatable (detected if omitted)
  --strength  how hard to carve, 0..1 (default ${DEFAULT_STRENGTH})
  --dry-run   report what it would write, touch nothing`;

export function parseArgs(argv) {
  const args = { strength: DEFAULT_STRENGTH, dryRun: false, voices: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) fail(`${shown(flag)} needs a value`);
      i += 1;
      return value;
    };
    if (flag === "--comp") args.comp = next();
    else if (flag === "--bed") args.bed = next();
    else if (flag === "--voice") args.voices.push(next());
    else if (flag === "--strength") args.strength = Number(next());
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "-h" || flag === "--help") fail(usage, 0);
    else fail(`unknown flag: ${shown(flag)}\n\n${usage}`);
  }
  if (!args.comp) fail(`--comp is required\n\n${usage}`);
  if (!Number.isFinite(args.strength) || args.strength < 0 || args.strength > 1) {
    fail("--strength must be a number from 0 to 1");
  }
  return args;
}

// Ids, group names and paths come from the composition, so each is escaped where it enters a message;
// every line is escaped again here for error text written elsewhere.
function fail(message, code = 1) {
  process.stderr.write(`${terminalLines(message)}\n`);
  process.exit(code);
}

/**
 * The `sources` a carve should record for these voices, on this bed.
 *
 * SKILL.md states the invariant: "A carve against more than one clip id is
 * wrong. Group the clips and carve against the group." Naming the group lets
 * `resolveCarveSourceIds` resolve membership at analysis time, so a voice added
 * later is covered without editing `sources` — whereas a list of clip ids rots
 * silently the moment a fourth narration clip appears. The lint rule
 * `audio_carve_ungrouped_sources` enforces exactly this.
 *
 * This script was writing clip ids unconditionally, so it violated its own
 * skill's invariant and tripped its own lint rule on every run. When every
 * voice shares one group, record the group. Mixed or ungrouped voices keep
 * their ids, and the lint rule then correctly tells the author to group them.
 *
 * The bed has to be part of the decision, because the group form resolves
 * LATER and wider than it looks. If the bed is itself a member of the voices'
 * group, `resolveCarveSourceIds` expands that id to every current member on the
 * next analysis — including the bed — and the bed ends up carved against
 * itself, which SKILL.md calls a bug rather than a mix choice. This run cannot
 * see it: `main()` sums the voice list it detected and never round-trips
 * through group resolution, so the first pass is correct and only the next
 * re-analysis in Studio is wrong. So decline the group form there and fall back
 * to clip ids, which is exactly the case `audio_carve_ungrouped_sources` exists
 * to put in front of the author.
 *
 * Only an `<audio>` bed can trip it: group membership is audio-only
 * (`audioGroupOf`), so `data-audio-group` on a `<video>` bed is ignored by core
 * and expanding a group can never pull it in.
 */
export function carveSources(voices, bed, members) {
  const group = sharedVoiceGroup(voices);
  return group && !groupSourceRefusal(voices, bed, members) ? [group] : voices.map((v) => v.id);
}

/** The one group every voice belongs to, or null if they do not share exactly one. */
function sharedVoiceGroup(voices) {
  const groups = voices.map((v) => attrOf(v.tag, "data-audio-group"));
  const first = groups[0];
  return Boolean(first) && groups.every((g) => g === first) ? first : null;
}

/**
 * Why naming the voices' shared group would persist something this run did not
 * analyse — or null when the group is safe to name.
 *
 * `members` is every `<audio>` in the composition as `{id, group, nameKind}`,
 * with `nameKind` from core's `classifyAudioName`, so this and Studio's picker
 * classify the same way.
 *
 * Required, deliberately not defaulting to `[]`. With an empty list the `mixed`
 * refusal below cannot fire, so a call that forgot the argument would return the
 * group form and restore the exact behaviour this function exists to prevent —
 * silently, because the first CLI pass is correct either way and only a later
 * Studio re-analysis is wrong. A missing argument throws on `members.filter`
 * instead.
 *
 * Two refusals, and both exist because the group form resolves LATER and WIDER
 * than the analysis: `resolveCarveSourceIds` expands a group id to every current
 * member on every analysis, and `resolveCarveVoices` keeps any audio member with
 * a src. `main()` meanwhile sums the voice list `detectTracks` returned, so the
 * first pass looks correct however wrong the persisted attribute is.
 *
 *   `bed`   — the bed is a member, so it would be handed to itself as a voice
 *             and carved against its own content.
 *   `mixed` — a member classified music or sfx is not a voice this run measured,
 *             so it would enter the sidechain on the next analysis and duck the
 *             bed under a whoosh.
 *
 * Deliberately NOT a refusal: a member classified `voice` or `unknown` that this
 * run left out. That is the group form working as designed — `detectTracks` only
 * takes voices that overlap the bed, and picking up a clip that starts playing
 * later without an edit to `sources` is the whole reason SKILL.md says to name
 * the group. Refusing there would collapse the group form into clip ids for
 * every ordinary narration sequence.
 */
export function groupSourceRefusal(voices, bed, members) {
  const group = sharedVoiceGroup(voices);
  if (!group) return null;
  if (bed?.kind === "audio" && attrOf(bed.tag, "data-audio-group") === group) {
    return { group, reason: "bed", ids: [bed.id] };
  }
  const analysed = new Set(voices.map((v) => v.id));
  const strays = members
    .filter(
      (m) =>
        m.group === group &&
        !analysed.has(m.id) &&
        (m.nameKind === "music" || m.nameKind === "sfx"),
    )
    .map((m) => m.id);
  return strays.length > 0 ? { group, reason: "mixed", ids: strays } : null;
}

// A URL scheme, or a Windows drive name such as `C:` that a relative-looking name can start with.
const SCHEME_OR_DRIVE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The file a composition's media `src` names. Only a relative name that lands on a regular file inside the
 * composition's folder, with links resolved, is accepted. Absolute, UNC, drive, URL and climbing names, and
 * files the project keeps private, throw before anything opens them.
 */
export function mediaSource(compDir, src) {
  const shown = JSON.stringify(src);
  const path = SCHEME_OR_DRIVE.test(src) ? null : projectPath(compDir, src);
  if (!path) {
    throw new Error(
      `media ${shown} is outside the composition's folder; copy it into the project and name it from there`,
    );
  }
  const rel = relative(realpathSync(compDir), path).split(sep).join("/");
  if (carveApi.isStudioPrivatePath(src) || carveApi.isStudioPrivatePath(rel)) {
    throw new Error(`media ${shown} is a private project file, so carve does not read it`);
  }
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`media ${shown} is not a file in the project`);
  }
  assertLiteralMediaPath(path);
  return path;
}

/** Mono float PCM for one media file, via ffmpeg reading that file alone. */
function decode(path) {
  const format = probeFormat(path);
  if (!format)
    fail(
      `could not decode ${shown(path)}: it is not media in an accepted container (${ACCEPTED_CONTAINERS})`,
    );
  if (isIndirectFormat(format)) {
    fail(
      `${shown(path)} is a ${shown(format)} list that points at other files; give the media file itself`,
    );
  }
  let raw;
  try {
    raw = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        ...pinnedInput(format, path),
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
    fail(`could not decode ${shown(path)}\n  ${shown(error.message.split("\n")[0])}`);
  }
  if (raw.length === 0) fail(`no audio in ${shown(path)}`);
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
    if (!found) fail(`no <audio>/<video> with id="${shown(id)}" in the composition`);
    return { ...found, why: `--${what}` };
  };

  let bed = given.bed ? pick(given.bed, "bed") : null;
  const named = given.voices.map((id) => pick(id, "voice"));

  if (!bed) {
    const others = all.filter((el) => !named.some((v) => v.id === el.id));
    const music = others.filter((el) => kindOf(el) === "music");
    if (music.length === 1) bed = { ...music[0], why: "name looks like music" };
    else if (music.length > 1) {
      fail(`several tracks look like music (${idList(music)}) — name one with --bed`);
    } else if (others.length === 1) {
      bed = { ...others[0], why: "only track left" };
    } else {
      fail(
        `cannot tell which track is the music bed\n` +
          `  media in the composition: ${idList(all) || "none"}\n` +
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
      `no voice to make room for on ${shown(bed.id)}\n` +
        `  media in the composition: ${idList(all) || "none"}\n` +
        `  name one with --voice`,
    );
  }
  return { bed, voices: usable, all };
}

const idList = (elements) => elements.map((el) => shown(el.id)).join(", ");

const startOf = (tag) => {
  const raw = Number(attrOf(tag, "data-start"));
  return Number.isFinite(raw) ? raw : 0;
};

/**
 * The composition's HTML. Throws when the name is a link or not a regular file, or when a folder
 * between the working folder and it is a link: a received project could point either at a file
 * outside the project, and the carve would read that file and write it back changed.
 */
export function readComposition(compPath, from = process.cwd()) {
  const rel = relative(from, compPath);
  // ".." alone or as the first part leaves the working folder; a name that only begins with two dots does not
  const leaves = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  const under = rel !== "" && !leaves;
  if (under && !isPlainProjectPath(from, rel) && lstatSync(compPath, { throwIfNoEntry: false })) {
    throw new Error(
      `${compPath} is a link or is reached through one, not a composition file; nothing was read or written`,
    );
  }
  const content = readRegularFile(compPath);
  if (content !== undefined) return content.toString("utf-8");
  if (lstatSync(compPath, { throwIfNoEntry: false })) {
    throw new Error(
      `${compPath} is a link or not a regular file, not a composition file; nothing was read or written`,
    );
  }
  throw new Error(`${compPath} does not exist`);
}

/**
 * Saves the composition as a new file renamed over the old one, so a link put at the name since the
 * read is replaced, not followed. The file keeps its permissions, and one that may not be written
 * is refused as before. Until it has those permissions the new file is readable by its owner only.
 * `written(temp)` runs once the text is in the new file, before it gets its permissions and its name.
 */
export function saveComposition(compPath, html, written = () => {}) {
  const old = lstatSync(compPath, { throwIfNoEntry: false });
  if (old?.isFile()) accessSync(compPath, constants.W_OK);
  const mode = old?.isFile() ? old.mode & 0o777 : 0o666 & ~process.umask();
  replaceFileWith(compPath, (temp) => {
    // The helper's temp is empty and has default permissions: ours is made again, owner-only, and filled by the handle that made it.
    rmSync(temp);
    const file = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(file, html);
      written(temp);
      fchmodSync(file, mode);
    } finally {
      closeSync(file);
    }
  });
}

/** The bed's existing effect chain; a malformed one stops the carve with nothing written. */
function chainNodes(text) {
  try {
    return carveApi.parseAudioFxChain(text).nodes;
  } catch {
    return fail(
      "the bed's data-fx-chain is not a valid effect chain; fix or remove it, then carve again",
    );
  }
}

/** The bed's existing automation lanes; malformed automation stops the carve with nothing written. */
function automationLanes(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("the bed's data-automation is not valid JSON; fix or remove it, then carve again");
  }
  const lanes = parsed?.lanes ?? [];
  if (!Array.isArray(lanes) || !lanes.every((lane) => lane && typeof lane === "object")) {
    return fail(
      "the bed's data-automation has no list of lanes; fix or remove it, then carve again",
    );
  }
  return lanes;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const compPath = resolve(args.comp);
  const compDir = dirname(compPath);

  let html;
  try {
    html = readComposition(compPath);
  } catch (error) {
    fail(error.message);
  }
  const {
    bed: bedEl,
    voices,
    all: media,
  } = detectTracks(html, args, carveApi.classifyAudioName, carveApi.clipsOverlap);
  // Group membership + name classification for every audio track, so the source
  // decision can see what the group will resolve to later and not just what this
  // run analysed.
  const members = media
    .filter((el) => el.kind === "audio")
    .map((el) => ({
      id: el.id,
      group: attrOf(el.tag, "data-audio-group"),
      nameKind: carveApi.classifyAudioName(el.id, unescapeAttr(attrOf(el.tag, "src") ?? "")),
    }));
  const bedTag = bedEl.tag;
  const bedSrc = attrOf(bedTag, "src");
  process.stdout.write(
    `bed    ${shown(bedEl.id)} (${bedEl.why})\n` +
      voices.map((v) => `voice  ${shown(v.id)} (${v.why})`).join("\n") +
      "\n",
  );

  const profile = carveApi.carveProfile(args.strength);
  // Every source is checked before any is decoded, so a refused name stops the carve with no ffmpeg run.
  let voicePaths;
  let bedPath = null;
  try {
    voicePaths = voices.map((v) => mediaSource(compDir, unescapeAttr(attrOf(v.tag, "src"))));
    if (profile.duckDb > 0) bedPath = mediaSource(compDir, unescapeAttr(bedSrc));
  } catch (error) {
    fail(error.message);
  }
  // Every voice summed onto the BED's clock before anything is measured. One
  // question — where and when is speech masking this bed — with one answer, even
  // when the answer comes from several people at different times.
  const voice = carveApi.mixCarveSources(
    voices.map((v, i) => ({
      samples: decode(voicePaths[i]),
      offsetSeconds: startOf(v.tag) - startOf(bedTag),
    })),
    SAMPLE_RATE,
  );
  if (voice.length === 0) fail("the voices do not overlap the bed, so there is nothing to carve");
  const bands = carveApi.analyseCarveBands(voice, SAMPLE_RATE, profile);

  // The level half of the carve needs both sides: "how far over the speech is this
  // bed" cannot be answered by listening to one of them. No offset — the mix is
  // already on the bed's clock.
  const bed = bedPath ? decode(bedPath) : null;
  const duck = bed ? carveApi.analyseCarveDuck(voice, bed, SAMPLE_RATE, profile, 0) : [];

  // Anything the author built by hand survives a carve; only the previous
  // carve's own nodes are replaced. That is what `fromCarve` is for.
  const existingChain = attrOf(bedTag, "data-fx-chain");
  const existingNodes = existingChain ? chainNodes(unescapeAttr(existingChain)) : [];
  const kept = existingNodes.filter((n) => !n.fromCarve);
  // Lanes belonging to the carve being replaced, addressed by the ids the OLD
  // nodes had. Taken before anything is minted: those ids are freed by the
  // replacement and a new node can be handed one of them, so reading them off the
  // new chain would keep exactly the stale lanes it is supposed to drop.
  const stalePrefixes = existingNodes.filter((n) => n.fromCarve && n.id).map((n) => `fx.${n.id}.`);

  let claimed = { version: 1, nodes: kept };
  const mint = (node) => {
    const withId = { ...node, id: carveApi.mintAudioFxNodeId(claimed), fromCarve: true };
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
            ...carveApi.defaultAudioFxParams("gain"),
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
    ? automationLanes(unescapeAttr(existingAutomation)).filter(
        (lane) => !stalePrefixes.some((prefix) => String(lane.target).startsWith(prefix)),
      )
    : [];
  const lanes = [...carriedLanes, ...carvedLanes];

  const settings = {
    enabled: true,
    sources: carveSources(voices, bedEl, members),
    strength: args.strength,
  };
  // Say why the group form was declined, or the lint rule tells the author to
  // group clips they have already grouped.
  const refusal = groupSourceRefusal(voices, bedEl, members);
  if (refusal) {
    process.stderr.write(
      refusal.reason === "bed"
        ? `note   bed ${shown(bedEl.id)} is in group "${shown(refusal.group)}" with the voices, so\n` +
            `       sources are clip ids: naming that group would carve the bed\n` +
            `       against itself on the next analysis. Move the bed to its own group.\n`
        : `note   group "${shown(refusal.group)}" also holds ${refusal.ids.map(shown).join(", ")}, which this run\n` +
            `       did not analyse (music/sfx by name), so sources are clip ids: naming\n` +
            `       the group would pull them into the sidechain on the next analysis.\n` +
            `       Move them out of the voice group.\n`,
    );
  }
  const written =
    ` data-fx-carve="${escapeAttr(JSON.stringify(settings))}"` +
    ` data-fx-chain="${escapeAttr(carveApi.serializeAudioFxChain(chain))}"` +
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
  try {
    saveComposition(compPath, html.replace(bedTag, nextTag));
  } catch (error) {
    fail(`could not save ${shown(args.comp)}: ${error.message}`);
  }
  process.stdout.write(`wrote ${shown(args.comp)} (id="${shown(bedEl.id)}")\n`);
}

// Only run as a CLI. Guarded so the pure helpers above can be unit-tested by
// importing this module (`skills/**/*.test.mjs`, run by `bun run test:skills`).
if (isMainModule(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    fail(`carve stopped: ${error?.message ?? error}`);
  }
}
