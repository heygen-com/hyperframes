import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync, symlinkSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  emitTimelineComposition,
  parseTimelineImport,
  resolveMediaStart,
  TIMELINE_IMPORT_SCHEMA_URL,
  type ImportClip,
  type ImportSequence,
} from "@hyperframes/core/timeline-import";
import { readJsonFileText } from "../utils/jsonFlag.js";
import { findFFmpeg } from "../browser/ffmpeg.js";
import { probeOrigin, type OriginProbe } from "./initTimelineOrigin.js";
import { encodeSequence, resolveSequenceFiles } from "./initTimelineSequence.js";

/**
 * The warnings as lines to print. A large edit can raise hundreds (one per offline clip), which
 * buries the few that matter, so only the first `limit` are shown and the rest are counted. The
 * converter's own output has them all, in the file's `warnings` and on its stderr.
 */
export function warningLines(warnings: string[], limit = 20): string[] {
  const shown = warnings.slice(0, limit).map((warning) => `  - ${warning}`);
  const rest = warnings.length - shown.length;
  return rest > 0
    ? [...shown, `  ... and ${rest} more; the converter's output lists every one under "warnings"`]
    : shown;
}

export interface StageTimelineOptions {
  /** A `hyperframes-timeline/1` JSON file (see `docs/reference/timeline-import.mdx`). */
  timelineFile: string;
  destDir: string;
  /** Where relative clip `src` values resolve from; defaults to the timeline file's folder. */
  mediaRoot?: string;
  /** Symlink media into `assets/` instead of copying it; copied where links are not available. */
  linkMedia?: boolean;
  /** Default: the running platform. Windows copies, as `skillsMirror` does. */
  platform?: NodeJS.Platform;
  /** Default: `fs.symlinkSync`. */
  symlink?: (target: string, path: string) => void;
  /** What a file says about where its own clock starts, and its length. Default: ffprobe. */
  probeOrigin?: (file: string) => OriginProbe | undefined;
  /** Length and audio of a file; the defaults of `mediaLength` and `hasAudioStream` read it. `undefined` when unreadable. */
  probeMedia?: (file: string) => { durationSeconds?: number; hasAudio?: boolean } | undefined;
  /** Whether a file has an audio stream; `undefined` when it cannot be probed. Default: `probeMedia`. */
  hasAudioStream?: (file: string) => boolean | undefined;
  /** Length in seconds of a file; `undefined` when it cannot be probed. Default: `probeMedia`. */
  mediaLength?: (file: string) => number | undefined;
  /** Writes the frame of `file` at `seconds` to `out`; returns false when it cannot. Default: ffmpeg. */
  extractFrame?: (file: string, seconds: number, out: string) => boolean;
  /** Encodes image files, one per frame, into a video at `out`; false when it cannot. Default: ffmpeg. */
  encodeSequence?: (files: string[], rate: number, out: string) => boolean;
}

export interface StagedTimeline {
  html: string;
  width: number;
  height: number;
  clipCount: number;
  warnings: string[];
}

const label = (clip: ImportClip) => clip.label ?? clip.id;

/** Why a symlink can fail where the filesystem or account does not allow one (FAT or exFAT drives,
 * network shares, a Windows account without Developer Mode). Anything else is a real error. */
const NO_LINKS = new Set(["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]);

const REMOTE = /^https?:\/\//i;

function sourcePath(src: string, root: string): string {
  if (src.startsWith("file://")) return fileURLToPath(src);
  return isAbsolute(src) ? src : resolve(root, src);
}

/** Relative `target_url` values are URL-style, so a space may arrive as `%20`. */
function locate(src: string, root: string): string | undefined {
  const candidates: string[] = [];
  // A `file://` URL with a host (a Windows path from another machine) or bad escapes cannot be turned
  // into a path: that is a missing file for this clip, not a reason to stop the import.
  for (const text of [src, safeDecode(src)]) {
    try {
      if (text !== undefined) candidates.push(sourcePath(text, root));
    } catch {
      // not a usable URL
    }
  }
  return candidates.find((file) => existsSync(file) && statSync(file).isFile());
}

const safeDecode = (text: string): string | undefined => {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined; // not percent-encoded text
  }
};

function ffmpegFrame(file: string, seconds: number, out: string): boolean {
  const ffmpeg = findFFmpeg();
  if (!ffmpeg) return false;
  try {
    execFileSync(
      ffmpeg,
      ["-v", "error", "-y", "-ss", String(seconds), "-i", file, "-frames:v", "1", out],
      { timeout: 30_000 },
    );
    return existsSync(out);
  } catch {
    return false;
  }
}

function freeAssetName(used: Set<string>, wanted: string): string {
  const ext = extname(wanted);
  const stem = basename(wanted, ext);
  let name = wanted;
  for (let n = 2; used.has(name); n++) name = `${stem}-${n}${ext}`;
  used.add(name);
  return name;
}

interface StageContext {
  options: StageTimelineOptions;
  root: string;
  assetsDir: string;
  usedNames: Set<string>;
  assetBySource: Map<string, string>;
  encodedSequences: Map<string, string>;
  warnings: string[];
  notFound: string[];
  linkNoted: boolean;
}

function readTimeline(file: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(readJsonFileText(file));
  } catch (err) {
    throw new Error(`Cannot read timeline ${file}: ${err instanceof Error ? err.message : err}`);
  }
  const parsed = parseTimelineImport(raw);
  if (!parsed.ok) {
    throw new Error(
      `Invalid timeline: ${parsed.error} (the format is defined at ${TIMELINE_IMPORT_SCHEMA_URL})`,
    );
  }
  return parsed.value;
}

const sequenceStem = (first: string) =>
  basename(first, extname(first))
    .replace(/[\d._-]+$/, "")
    .replace(/[^\w-]+/g, "") || "sequence";

/** A frame of a sequence held for a whole clip becomes a still in assets/. */
function stageSequenceStill(
  ctx: StageContext,
  clip: ImportClip,
  first: string,
): ImportClip | undefined {
  const extractStill = ctx.options.extractFrame ?? ffmpegFrame;
  const image = locate(first, ctx.root);
  const still = freeAssetName(ctx.usedNames, `${sequenceStem(first)}-freeze.png`);
  mkdirSync(ctx.assetsDir, { recursive: true });
  if (image === undefined || !extractStill(image, 0, join(ctx.assetsDir, still))) {
    ctx.warnings.push(
      `clip "${label(clip)}": its freeze frame ${first} was not found or could not be read (clip skipped)`,
    );
    return undefined;
  }
  const key = `sequence:${clip.id}`;
  ctx.assetBySource.set(key, still);
  return {
    ...clip,
    kind: "image",
    src: key,
    mediaStart: 0,
    sequence: null,
    freeze: false,
    hasAudio: false,
    playbackRate: null,
  };
}

/** A sequence is encoded to one video in assets/, shared by clips that play the same images. */
function stageSequenceVideo(
  ctx: StageContext,
  clip: ImportClip,
  seq: ImportSequence,
  first: string,
): ImportClip | undefined {
  const encode = ctx.options.encodeSequence ?? encodeSequence;
  const key = `sequence:${seq.rate}|${seq.images.join("\n")}`;
  let video = ctx.encodedSequences.get(key);
  if (video === undefined) {
    const resolved = resolveSequenceFiles(seq.images, (image) => locate(image, ctx.root));
    if (resolved === null) {
      ctx.warnings.push(`clip "${label(clip)}": no image of ${first} was found (clip skipped)`);
      return undefined;
    }
    if (resolved.missing > 0) {
      ctx.warnings.push(
        `clip "${label(clip)}": ${resolved.missing} of ${seq.images.length} frames have no image on disk; the previous image is held`,
      );
    }
    const name = freeAssetName(ctx.usedNames, `${sequenceStem(first)}.mp4`);
    mkdirSync(ctx.assetsDir, { recursive: true });
    if (!encode(resolved.files, seq.rate, join(ctx.assetsDir, name))) {
      ctx.warnings.push(
        `clip "${label(clip)}": could not encode ${first} (ffmpeg missing or an image is unreadable) (clip skipped)`,
      );
      return undefined;
    }
    video = name;
    ctx.encodedSequences.set(key, video);
  }
  const assetKey = `sequence:${clip.id}`;
  ctx.assetBySource.set(assetKey, video);
  return { ...clip, src: assetKey, mediaStart: 0, sequence: null, hasAudio: false };
}

/** A sequence becomes a video (or, held, a still) in assets/, so the rest of the import sees a file. */
function stageSequence(
  ctx: StageContext,
  clip: ImportClip,
  seq: ImportSequence,
): ImportClip | undefined {
  const first = seq.images[0] ?? clip.src;
  const remote = seq.images.find((image) => REMOTE.test(image));
  if (remote !== undefined) {
    ctx.warnings.push(
      `clip "${label(clip)}" points at remote images (${remote}), which are not downloaded (clip skipped)`,
    );
    return undefined;
  }
  return clip.freeze
    ? stageSequenceStill(ctx, clip, first)
    : stageSequenceVideo(ctx, clip, seq, first);
}

/** `--link-media`: a symlink to the footage, or a copy where links cannot be made. Windows copies
 * outright, the way `skillsMirror` does, because links there need Developer Mode or an
 * administrator and fail without a clear reason. */
function linkOrCopy(ctx: StageContext, from: string, to: string): void {
  const copyInstead = (why: string) => {
    copyFileSync(from, to);
    if (!ctx.linkNoted) {
      ctx.linkNoted = true;
      ctx.warnings.push(`--link-media copied the media instead of linking it (${why})`);
    }
  };
  if ((ctx.options.platform ?? process.platform) === "win32")
    return copyInstead("links on Windows need Developer Mode or an administrator");
  try {
    (ctx.options.symlink ?? symlinkSync)(from, to);
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String(err.code) : "";
    if (!NO_LINKS.has(code)) throw err;
    copyInstead(`this disk or account does not allow links: ${code}`);
  }
}

/** Copies (or links) the clip's file into assets/ once; false when the clip has to be skipped. */
function stageFile(ctx: StageContext, clip: ImportClip): boolean {
  if (ctx.assetBySource.has(clip.src)) return true;
  if (REMOTE.test(clip.src)) {
    ctx.warnings.push(
      `clip "${label(clip)}" points at remote media (${clip.src}), which is not downloaded (clip skipped)`,
    );
    return false;
  }
  const from = locate(clip.src, ctx.root);
  if (from === undefined) {
    ctx.notFound.push(clip.src);
    ctx.warnings.push(`media not found for clip "${label(clip)}": ${clip.src} (clip skipped)`);
    return false;
  }
  mkdirSync(ctx.assetsDir, { recursive: true });
  const asset = freeAssetName(ctx.usedNames, basename(from));
  const to = join(ctx.assetsDir, asset);
  if (ctx.options.linkMedia) linkOrCopy(ctx, from, to);
  else copyFileSync(from, to);
  ctx.assetBySource.set(clip.src, asset);
  return true;
}

function stageClips(ctx: StageContext, clips: ImportClip[]): ImportClip[] {
  const kept: ImportClip[] = [];
  for (const clip of clips) {
    const staged = clip.sequence !== null ? stageSequence(ctx, clip, clip.sequence) : clip;
    if (staged === undefined) continue;
    if (clip.sequence === null && !stageFile(ctx, clip)) continue;
    kept.push(staged);
  }
  return kept;
}

interface OriginState {
  probe: (file: string) => OriginProbe | undefined;
  probed: Map<string, OriginProbe | undefined>;
  noted: Set<string>;
  blind: boolean;
}

/** Warns once per file when its own timecode did not fit the edit, and per clip when nothing did. */
function noteOffset(
  ctx: StageContext,
  state: OriginState,
  clip: ImportClip,
  asset: string,
  facts: OriginProbe,
  fileOrigin: number,
  offset: ReturnType<typeof resolveMediaStart>,
): void {
  if (offset.basis === "unfit") {
    ctx.warnings.push(
      `clip "${label(clip)}": it starts ${clip.mediaStart}s into its source but ${asset} is only ${facts.duration ?? "?"}s long` +
        (fileOrigin > 0 ? ` (its own timecode starts at ${fileOrigin}s)` : "") +
        "; it will be silent or frozen",
    );
    return;
  }
  if (offset.basis === "file" || state.noted.has(asset)) return;
  state.noted.add(asset);
  const own = fileOrigin > 0 ? `its timecode (${fileOrigin}s)` : "its start";
  ctx.warnings.push(
    offset.basis === "hint"
      ? `${asset}: ${own} does not fit the edit, so the start the timeline states was used instead`
      : `${asset}: ${own} does not fit the edit, so the offsets were read as seconds into the file`,
  );
}

/** A video reads its picture's timecode first and an audio file its sample clock; either falls back to the other. */
function ownOrigin(clip: ImportClip, facts: OriginProbe): number {
  const [first, second] =
    clip.kind === "audio"
      ? [facts.timeReference, facts.timecode]
      : [facts.timecode, facts.timeReference];
  return first ?? second ?? 0;
}

function placeClip(ctx: StageContext, state: OriginState, clip: ImportClip): ImportClip {
  if (clip.kind === "image" || clip.sequence !== null) return clip;
  const asset = ctx.assetBySource.get(clip.src);
  if (asset === undefined) return clip;
  if (!state.probed.has(asset)) state.probed.set(asset, state.probe(join(ctx.assetsDir, asset)));
  const facts = state.probed.get(asset);
  if (facts === undefined) {
    state.blind = true;
    return clip;
  }
  const fileOrigin = ownOrigin(clip, facts);
  const offset = resolveMediaStart({
    mediaStart: clip.mediaStart,
    fileOrigin,
    mediaOrigin: clip.mediaOrigin,
    fileDuration: facts.duration,
  });
  noteOffset(ctx, state, clip, asset, facts, fileOrigin, offset);
  return { ...clip, mediaStart: offset.mediaStart };
}

/** `mediaStart` is a position on the source's own clock, which is its start timecode for a file
 * that carries one. Only the file knows that timecode, so each clip's offset into the file is
 * worked out here, before anything (a freeze frame, a dissolve's handles) reads it. */
function placeClips(ctx: StageContext, kept: ImportClip[]): ImportClip[] {
  const state: OriginState = {
    probe: ctx.options.probeOrigin ?? probeOrigin,
    probed: new Map(),
    noted: new Set(),
    blind: false,
  };
  const placed = kept.map((clip) => placeClip(ctx, state, clip));
  if (state.blind) {
    ctx.warnings.push(
      "ffprobe is not available, so media offsets were not checked against each file's own timecode",
    );
  }
  return placed;
}

function repeatedAudioMessage(group: ImportClip[]): string | undefined {
  const [first] = group;
  if (group.length < 2 || first === undefined) return undefined;
  const lanes = new Set(group.map((clip) => clip.trackIndex)).size;
  const louder = Math.round(20 * Math.log10(group.length));
  return (
    `audio "${label(first)}" plays ${group.length} times at the same moment from the same part of the same file` +
    (lanes > 1 ? `, on ${lanes} tracks` : "") +
    `, so it is about ${louder} dB louder than one copy; remove a copy if that is not intended`
  );
}

/** The same part of the same file, at the same moment, on two tracks plays twice and the two add
 * up. An editor can export a stereo stem as two mono tracks that each play the whole file, which
 * is how this happens without anyone meaning it. Both are kept; the warning leaves the choice. */
function warnAboutRepeatedAudio(warnings: string[], placed: ImportClip[]): void {
  const twins = new Map<string, ImportClip[]>();
  for (const clip of placed) {
    if (clip.kind !== "audio") continue;
    const key = [
      clip.src,
      clip.mediaStart,
      clip.start,
      clip.duration,
      clip.playbackRate ?? 1,
      clip.volume ?? 1,
    ].join("|");
    twins.set(key, [...(twins.get(key) ?? []), clip]);
  }
  for (const group of twins.values()) {
    const message = repeatedAudioMessage(group);
    if (message !== undefined) warnings.push(message);
  }
}

/** A freeze frame holds one frame for the whole clip, so it becomes a still taken from the video. */
function freezeClip(ctx: StageContext, clip: ImportClip): ImportClip {
  if (clip.kind !== "video" || !clip.freeze) return clip;
  const extractFrame = ctx.options.extractFrame ?? ffmpegFrame;
  const source = ctx.assetBySource.get(clip.src);
  const still = freeAssetName(
    ctx.usedNames,
    `${basename(source ?? "clip", extname(source ?? ""))}-freeze.png`,
  );
  if (
    source === undefined ||
    !extractFrame(join(ctx.assetsDir, source), clip.mediaStart, join(ctx.assetsDir, still))
  ) {
    ctx.warnings.push(
      `clip "${label(clip)}": could not take the freeze frame (ffmpeg missing or the file is unreadable); it plays normally`,
    );
    return { ...clip, freeze: false };
  }
  const key = `freeze:${clip.id}`;
  ctx.assetBySource.set(key, still);
  return {
    ...clip,
    kind: "image" as const,
    src: key,
    mediaStart: 0,
    playbackRate: null,
    hasAudio: false,
    freeze: false,
  };
}

/** A video-only timeline means the editor kept sound inside the video files, but a file with no
 * audio stream cannot be declared as having audio (the render refuses it), so check each file. */
function checkAudioStreams(ctx: StageContext, clips: ImportClip[]): ImportClip[] {
  const { options } = ctx;
  const hasAudioStream =
    options.hasAudioStream ?? ((file: string) => options.probeMedia?.(file)?.hasAudio);
  const audioByAsset = new Map<string, boolean | undefined>();
  let unprobed = false;
  const checked = clips.map((clip) => {
    if (clip.kind !== "video" || !clip.hasAudio) return clip;
    const asset = ctx.assetBySource.get(clip.src) ?? "";
    if (!audioByAsset.has(asset)) {
      audioByAsset.set(asset, hasAudioStream(join(ctx.assetsDir, asset)));
    }
    const audio = audioByAsset.get(asset);
    if (audio === undefined) unprobed = true;
    return audio === false ? { ...clip, hasAudio: false } : clip;
  });
  if (unprobed) {
    ctx.warnings.push(
      "ffprobe is not available, so video clips were assumed to carry their own audio",
    );
  }
  return checked;
}

function noMediaError(root: string, notFound: string[]): Error {
  const distinct = new Set(notFound);
  const shown = [...distinct].slice(0, 3).join(", ");
  const more = distinct.size - 3;
  return new Error(
    `No clip has media on disk (looked under ${root}).` +
      (shown ? ` Not found: ${shown}${more > 0 ? ` and ${more} more` : ""}.` : "") +
      " Check --media-root. If these are paths from the editor's own machine, relink the timeline" +
      " to your files first and convert it again" +
      " (https://hyperframes.heygen.com/reference/timeline-import#paths-from-another-machine).",
  );
}

/**
 * Reads the timeline, copies (or links) each referenced file into `assets/`, and returns the
 * composition HTML pointing at them. Clips whose media is missing are dropped with a warning,
 * because a missing source renders as a failed clip.
 */
export function stageTimeline(options: StageTimelineOptions): StagedTimeline {
  const timeline = readTimeline(options.timelineFile);
  const ctx: StageContext = {
    options,
    root: resolve(
      options.mediaRoot ?? timeline.mediaRoot ?? dirname(resolve(options.timelineFile)),
    ),
    assetsDir: join(options.destDir, "assets"),
    usedNames: new Set(),
    assetBySource: new Map(),
    encodedSequences: new Map(),
    warnings: [],
    notFound: [],
    linkNoted: false,
  };

  const kept = stageClips(ctx, timeline.clips);
  const placed = placeClips(ctx, kept);
  warnAboutRepeatedAudio(ctx.warnings, placed);
  const held = placed.map((clip) => freezeClip(ctx, clip));
  const checked = checkAudioStreams(ctx, held);
  if (kept.length === 0) throw noMediaError(ctx.root, ctx.notFound);

  const mediaLength =
    options.mediaLength ?? ((file: string) => options.probeMedia?.(file)?.durationSeconds);
  const emitted = emitTimelineComposition(
    { ...timeline, clips: checked },
    {
      // The name on disk is kept; `src` is a URL, where `#` starts a fragment and `?` a query, so
      // the file name is written as one path segment (`take#1.mp4` is `take%231.mp4`).
      srcFor: (clip) =>
        `assets/${encodeURIComponent(ctx.assetBySource.get(clip.src) ?? basename(clip.src))}`,
      // Dissolves play footage past each trim point, so each file's length bounds them.
      mediaDuration: (clip) => {
        const asset = ctx.assetBySource.get(clip.src);
        return asset === undefined ? undefined : mediaLength(join(ctx.assetsDir, asset));
      },
    },
  );

  return {
    html: emitted.html,
    width: emitted.width,
    height: emitted.height,
    clipCount: kept.length,
    warnings: [...ctx.warnings, ...emitted.warnings],
  };
}
