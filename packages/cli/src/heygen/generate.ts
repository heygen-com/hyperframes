// New media on HeyGen for `media-use generate`: a still (optionally edited from a reference), a shot (optionally from
// a first frame), a person speaking from one photo, a voice reading text, or music. Every call is priced first with
// --plan, keyed for idempotency, downloaded into the project and recorded in the media ledger as generated.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { findCuts, signatures } from "../measure/cuts.js";
import { Fix, probeVideo, projectOf, round, runFfmpeg, videoClip } from "../measure/media.js";
import { idempotencyKey, runJob, type Job } from "./v3.js";

export type GenerateType = "image" | "video" | "avatar" | "voice" | "music";
export const GENERATE_TYPES: readonly GenerateType[] = [
  "image",
  "video",
  "avatar",
  "voice",
  "music",
];

export interface GenerateRequest {
  type: GenerateType;
  out: string;
  prompt?: string;
  /** image: pictures the result is edited from or styled after. video: the person or things to keep in the shot. */
  references?: string[];
  /** video: speech the person in the references says, lips in sync (a stretch of the original's voice). */
  audio?: string;
  /** video: a clip whose camera and body motion the shot follows (the original's same stretch, up to 15 s). */
  motion?: string;
  /** video: skip the one-shot check of the motion clip (a guide a person has looked at). */
  allowCuts?: boolean;
  /** video: regions of the motion clip blanked before it is sent (its drawn text), so the shot does not copy them. */
  masks?: Mask[];
  /** video: the shot starts from this picture. */
  firstFrame?: string;
  /** avatar: the photo of the person who speaks. */
  photo?: string;
  /** avatar and voice: what is said. */
  script?: string;
  voice?: string;
  seconds?: number;
  aspect?: string;
  model?: string;
  instrumental?: boolean;
  bpm?: number;
}

/** A region of the motion clip in its pixels, and optionally the seconds of the clip it covers. */
export interface Mask {
  box: [number, number, number, number];
  window?: [number, number];
}

/** `x,y,w,h` or `x,y,w,h,a-b` (seconds of the motion clip). */
export function parseMask(text: string): Mask {
  const m =
    /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*)?$/.exec(
      text,
    );
  if (!m || Number(m[3]) <= 0 || Number(m[4]) <= 0)
    throw new Fix(`--mask ${text} is not x,y,w,h[,a-b]`, "--mask 190,405,700,175,1.0-2.7");
  const box: Mask["box"] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return m[5] ? { box, window: [Number(m[5]), Number(m[6])] } : { box };
}

/**
 * Fills a box from the pixels around it (ffmpeg delogo): no letter survives, but the box is smeared. Delogo needs a
 * pixel of picture on every side, so boxes are kept 1 px inside the frame.
 */
function delogoFilters(masks: Mask[], width: number, height: number): string {
  return masks
    .flatMap(({ box: [x, y, w, h], window }) => {
      const [x0, y0] = [Math.max(1, x), Math.max(1, y)];
      const [x1, y1] = [Math.min(width - 2, x + w), Math.min(height - 2, y + h)];
      if (x1 - x0 < 1 || y1 - y0 < 1) return [];
      const when = window ? `:enable='between(t,${window[0]},${window[1]})'` : "";
      return [`delogo=x=${x0}:y=${y0}:w=${x1 - x0}:h=${y1 - y0}${when}`];
    })
    .join(",");
}

/** A box's temporal median over about a second either side: moving text becomes the picture behind it. */
function maskFilters(masks: Mask[], fps: number): string {
  const radius = Math.min(127, Math.max(2, Math.round(fps)));
  const steps = masks.map(({ box: [x, y, w, h], window }, i) => {
    const when = window ? `:enable='between(t,${window[0]},${window[1]})'` : "";
    const [w2, h2] = [w - (w % 2), h - (h % 2)];
    return `[v${i}]split[a${i}][b${i}];[b${i}]crop=${w2}:${h2}:${x}:${y},tmedian=radius=${radius}[m${i}];[a${i}][m${i}]overlay=${x}:${y}${when}[v${i + 1}]`;
  });
  return `[0:v]null[v0];${steps.join(";")}`;
}

/** Mean absolute pixel step inside a box and in a ring around it: the box holds more edges when inside > ring. */
export function structureRatio(
  gray: Uint8Array,
  width: number,
  box: [number, number, number, number],
): { inside: number; ring: number } {
  const height = gray.length / width;
  const [x0, y0, x1, y1] = [box[0], box[1], box[0] + box[2], box[1] + box[3]];
  const pad = Math.max(box[2], box[3]) >> 1;
  const sum = [0, 0];
  const n = [0, 0];
  for (let y = Math.max(0, y0 - pad); y < Math.min(height - 1, y1 + pad); y++)
    for (let x = Math.max(0, x0 - pad); x < Math.min(width - 1, x1 + pad); x++) {
      const k = x >= x0 && x < x1 && y >= y0 && y < y1 ? 0 : 1;
      const i = y * width + x;
      sum[k]! += Math.abs(gray[i]! - gray[i + 1]!) + Math.abs(gray[i]! - gray[i + width]!);
      n[k]!++;
    }
  return { inside: sum[0]! / (n[0] || 1), ring: sum[1]! / (n[1] || 1) };
}

interface Route {
  path: string;
  poll: (id: string) => string;
  body: (r: GenerateRequest, media: Media) => Record<string, unknown>;
  /** Where the finished job keeps the file's URL. */
  urls: string[];
  ledger: "image" | "video" | "voice" | "bgm";
  ext: string[];
}

type Media = (
  path: string,
  kind: "image" | "audio" | "video",
) => { type: "base64"; media_type: string; data: string };

const DEFAULTS = { image: "nano-banana-2", video: "heygen-video-1", music: "lyria-3-pro" } as const;
const VIDEO_RESOLUTION = "768p";
/** HeyGen follows at most this many seconds of a guide clip; the rest is not sent. */
export const GUIDE_MAX_S = 15;
const MUSIC_LENGTHS = [30, 60, 120, 180];

const need = <T>(value: T | undefined, flag: string, example: string): T => {
  if (value === undefined || value === "")
    throw new Fix(`${flag} is required for this type`, example);
  return value;
};

const ROUTES: Record<GenerateType, Route> = {
  image: {
    path: "/v3/images",
    poll: (id) => `/v3/images/${id}`,
    body: (r, media) => ({
      model: r.model ?? DEFAULTS.image,
      prompt: need(r.prompt, "--prompt", '--prompt "the same room, empty, no text"'),
      num_images: 1,
      ...(r.aspect ? { aspect_ratio: r.aspect } : {}),
      ...(r.references?.length
        ? { reference_images: r.references.map((p) => media(p, "image")) }
        : {}),
    }),
    urls: ["images.0.url", "image_url", "url"],
    ledger: "image",
    ext: [".png", ".jpg", ".jpeg", ".webp"],
  },
  video: {
    path: "/v3/models/videos",
    poll: (id) => `/v3/models/videos/${id}`,
    // fallow-ignore-next-line complexity
    body: (r, media) => {
      // A person speaking given audio is a reference shot: the references show who, the audio drives the lips.
      const spoken = !!r.audio || !!r.references?.length || !!r.motion;
      if (spoken && r.firstFrame)
        throw new Fix(
          "--first-frame cannot be used with --reference, --audio or --motion",
          "a speaking shot takes the person as --reference and the voice as --audio",
        );
      return {
        model: r.model ?? DEFAULTS.video,
        mode: spoken ? "reference_to_video" : r.firstFrame ? "image_to_video" : "text_to_video",
        prompt: need(r.prompt, "--prompt", '--prompt "slow push in on the desk"'),
        duration: Math.min(15, Math.max(5, Math.round(r.seconds ?? 5))),
        // 1080p bills about twice 768p (2026-10-23, 5 s 9:16 jobs: text $0.10 vs $0.20, a reference picture $0.25
        // vs $0.45, a 1 s guide clip $0.30 vs $0.55), so every shot stays at 768p whatever the source's size.
        resolution: VIDEO_RESOLUTION,
        ...(r.firstFrame ? { image: media(r.firstFrame, "image") } : {}),
        ...(r.firstFrame ? {} : { aspect_ratio: r.aspect ?? "16:9" }),
        ...(r.references?.length
          ? { reference_images: r.references.map((p) => media(p, "image")) }
          : {}),
        ...(r.audio ? { reference_audio: [media(r.audio, "audio")] } : {}),
        // One guide clip: HeyGen follows its camera and body motion, and takes the face from the references.
        ...(r.motion ? { reference_videos: [media(r.motion, "video")] } : {}),
      };
    },
    urls: ["video_url", "output.video_url", "url"],
    ledger: "video",
    ext: [".mp4", ".mov", ".webm"],
  },
  avatar: {
    path: "/v3/videos",
    poll: (id) => `/v3/videos/${id}`,
    body: (r, media) => ({
      type: "image",
      image: media(need(r.photo, "--photo", "--photo assets/presenter.png"), "image"),
      script: need(r.script, "--script", '--script "What they say"'),
      voice_id: need(
        r.voice,
        "--voice",
        "--voice <voice id> (npx hyperframes media-use resolve --type voice lists voices)",
      ),
      ...(r.aspect ? { aspect_ratio: r.aspect } : {}),
      output_format: "mp4",
    }),
    urls: ["video_url"],
    ledger: "video",
    ext: [".mp4"],
  },
  voice: {
    path: "/v3/voices/speech",
    poll: (id) => `/v3/voices/speech/${id}`,
    body: (r) => ({
      text: need(r.script, "--script", '--script "What the voice says"'),
      voice_id: need(r.voice, "--voice", "--voice <voice id>"),
    }),
    urls: ["audio_url"],
    ledger: "voice",
    ext: [".mp3", ".wav", ".m4a"],
  },
  music: {
    path: "/v3/audio/music",
    poll: (id) => `/v3/audio/music/${id}`,
    body: (r) => ({
      model: r.model ?? DEFAULTS.music,
      prompt: need(r.prompt, "--prompt", '--prompt "warm lo-fi beat, soft keys"'),
      duration_seconds: MUSIC_LENGTHS.find((s) => s >= (r.seconds ?? 30)) ?? 180,
      instrumental: r.instrumental ?? true,
      ...(r.bpm ? { bpm: Math.round(r.bpm) } : {}),
    }),
    urls: ["audio_url"],
    ledger: "bgm",
    ext: [".mp3"],
  },
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The first URL at any of these dotted paths of a job. */
export function urlOf(job: Job, paths: string[]): string | null {
  for (const p of paths) {
    let v: unknown = job;
    for (const key of p.split("."))
      v = Array.isArray(v) ? v[Number(key)] : isRecord(v) ? v[key] : undefined;
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return null;
}

function needFile(path: string): void {
  if (!existsSync(path))
    throw new Fix(`no file at ${path}`, "pass a picture or sound from the project");
}

const shrink = (path: string, out: string) =>
  runFfmpeg([
    "-y",
    "-i",
    path,
    "-vf",
    "scale='min(2048,iw)':'min(2048,ih)':force_original_aspect_ratio=decrease",
    "-q:v",
    "3",
    "-frames:v",
    "1",
    out,
  ]);

/**
 * A picture or a sound as the routes take it inline, pictures shrunk to 2048 px so the body stays small, a motion
 * clip with its masks filled.
 */
function inline(work: string, masks: Mask[] = []): Media {
  return (path, kind) => {
    needFile(path);
    const out = join(
      work,
      `in-${Math.random().toString(36).slice(2)}.${{ image: "jpg", audio: "mp3", video: "mp4" }[kind]}`,
    );
    if (kind === "image") shrink(path, out);
    else if (kind === "audio")
      runFfmpeg(["-y", "-i", path, "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", out]);
    // A guide clip only needs its motion: 720 px on the long side, no sound, at most 15 s.
    else {
      const guide = masks.length ? fillMasks(path, masks, work) : path;
      const scale = "scale='if(gt(iw,ih),min(720,iw),-2)':'if(gt(iw,ih),-2,min(720,ih))'";
      runFfmpeg([
        ...["-y", "-i", guide, "-t", "15", "-an", "-vf", scale],
        ...["-c:v", "libx264", "-crf", "28", "-preset", "veryfast", "-pix_fmt", "yuv420p", out],
      ]);
    }
    return {
      type: "base64",
      media_type: { image: "image/jpeg", audio: "audio/mpeg", video: "video/mp4" }[kind],
      data: readFileSync(out).toString("base64"),
    };
  };
}

/**
 * The seconds where a new shot starts in a video's first `seconds`, and the length read. A cut within a frame of
 * either end leaves a stray frame, not a second shot, and does not count.
 */
function cutsInside(path: string, seconds?: number): { cuts: number[]; length: number } {
  const info = probeVideo(path);
  const clip = videoClip(info.path, 0, seconds, info);
  const { frames } = signatures(clip.input, clip.filters);
  const cuts = findCuts(frames)
    .filter((c) => c.frame > 1 && c.frame < frames.length - 1)
    .map((c) => round(c.frame / info.fps, 3));
  return { cuts, length: round(frames.length / info.fps, 3) };
}

/** The masks whose box, in `clip`'s frames, holds more edges than the picture around it at some sampled time. */
function structured(clip: string, guide: { width: number; height: number }, masks: Mask[]) {
  const { width: w, height: h } = probeVideo(clip);
  const gray = runFfmpeg(["-i", clip, "-vf", "fps=2", "-pix_fmt", "gray", "-f", "rawvideo", "-"]);
  // The box as a fraction of the guide's frame, in the clip's pixels (its size and aspect may differ).
  const [kx, ky] = [w / guide.width, h / guide.height];
  return masks.flatMap((mask) => {
    const [bx, by, bw, bh] = mask.box;
    const box = [bx * kx, by * ky, bw * kx, bh * ky].map(Math.round) as Mask["box"];
    let worst = 0;
    for (let i = 0; (i + 1) * w * h <= gray.length; i++) {
      if (mask.window && (i / 2 < mask.window[0] || i / 2 > mask.window[1])) continue;
      const { inside, ring } = structureRatio(gray.subarray(i * w * h, (i + 1) * w * h), w, box);
      if (inside > 6 && inside > 1.5 * ring) worst = Math.max(worst, inside / (ring || 1));
    }
    return worst ? [{ mask, worst }] : [];
  });
}

/** A copy of the guide with each mask's box filled: the temporal median, and delogo's smear where text stays put. */
function fillMasks(path: string, masks: Mask[], work: string): string {
  const info = probeVideo(path);
  const encode = (from: string, name: string, filter: string[]) => {
    const out = join(work, name);
    runFfmpeg([
      ...["-y", "-i", from, "-an"],
      ...filter,
      ...["-crf", "14", "-pix_fmt", "yuv420p", out],
    ]);
    return out;
  };
  const median = encode(path, "median.mp4", [
    ...["-t", "15", "-filter_complex", maskFilters(masks, info.fps)],
    ...["-map", `[v${masks.length}]`],
  ]);
  const left = structured(median, info, masks).map((s) => s.mask);
  if (!left.length) return median;
  return encode(median, "delogo.mp4", ["-vf", delogoFilters(left, info.width, info.height)]);
}

/**
 * HeyGen answers a 16:9 request at 1344x768 (1.75:1). The result is cropped, centred, to the requested ratio
 * (1344x756) rather than stretched; returns a note on what was done, or nothing when it already fits.
 */
export function fitAspect(out: string, aspect: string): string | undefined {
  const [aw, ah] = aspect.split(":").map(Number);
  if (!aw || !ah) return;
  const { width, height } = probeVideo(out);
  const want = aw / ah;
  if (Math.abs(width / height - want) / want < 0.002) return;
  const even = (n: number) => n - (n % 2);
  const [w, h] =
    width / height > want ? [even(height * want), height] : [width, even(width / want)];
  const fitted = `${out}.fit${extname(out)}`;
  runFfmpeg([
    ...[
      "-y",
      "-i",
      out,
      "-vf",
      `crop=${w}:${h}`,
      "-c:v",
      "libx264",
      "-crf",
      "12",
      "-preset",
      "slow",
    ],
    ...["-pix_fmt", "yuv420p", "-c:a", "copy", fitted],
  ]);
  renameSync(fitted, out);
  return `HeyGen returned ${width}x${height} for ${aspect}; cropped to ${w}x${h} (centre), not stretched`;
}

function aspectOf(r: GenerateRequest, work: string): string {
  if (r.aspect || !r.firstFrame) return r.aspect ?? "16:9";
  const sent = join(work, "first-frame.jpg");
  shrink(r.firstFrame, sent);
  const { width, height } = probeVideo(sent);
  return `${width}:${height}`;
}

const MIN_SHOT_S = 0.15;

export function foldShort(cuts: number[], length: number): number[] {
  const kept = [...cuts];
  for (;;) {
    const edges = [0, ...kept, length];
    const short = edges.slice(1).findIndex((e, i) => e - edges[i]! < MIN_SHOT_S);
    if (short < 0 || !kept.length) return kept;
    kept.splice(short ? short - 1 : 0, 1);
  }
}

const COUNT = ["", "one", "two", "three", "four", "five", "six"];

/**
 * Refuses a --motion clip holding more than one shot before anything is sent: HeyGen follows the guide's cut into
 * a cut of its own, so each shot is its own generation.
 */
function checkGuide(r: Pick<GenerateRequest, "motion" | "allowCuts">): void {
  if (!r.motion || r.allowCuts) return;
  const found = cutsInside(r.motion, GUIDE_MAX_S);
  const { length } = found;
  const cuts = foldShort(found.cuts, length);
  if (!cuts.length) return;
  const s = (t: number) => t.toFixed(2);
  const and = (items: string[]) => `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
  const at =
    cuts.length > 1 ? `cuts at ${and(cuts.map((t) => `${s(t)} s`))}` : `a cut at ${s(cuts[0]!)} s`;
  const edges = [0, ...cuts, length];
  const shots = edges.slice(1).map((e, i) => `${i ? s(edges[i]!) : "0"}–${s(e)} s`);
  throw new Fix(
    `--motion ${r.motion} has ${at}`,
    `guide has ${at}: generate ${and(shots)} as ${COUNT[shots.length] ?? shots.length} shots, each with its own --motion clip, or pass --allow-cuts for a guide you have checked`,
  );
}

/** What the real call would refuse, checked without sending anything: `--plan` prices only a request that would run.
 *  The route's body runs with a stand-in for the media, so its required flags and conflicts are checked as sent. */
export function checkRequest(r: GenerateRequest): void {
  const route = ROUTES[r.type];
  if (!route.ext.includes(extname(r.out).toLowerCase()))
    throw new Fix(`--out ${r.out} does not fit a ${r.type}`, `--out assets/name${route.ext[0]}`);
  if (r.masks?.length && !r.motion)
    throw new Fix("--mask blanks regions of the --motion clip", "pass --motion with --mask");
  route.body(r, (path) => {
    needFile(path);
    return { type: "base64", media_type: "", data: "" };
  });
  checkGuide(r);
}

export interface Generated {
  out: string;
  type: GenerateType;
  job: string;
  route: string;
  ledger?: string;
  /** video: seconds where HeyGen cut inside the returned shot; null when the file could not be read. */
  cuts_inside?: number[] | null;
  /** What was changed or looks wrong in the result: a crop to the requested aspect, text that may have come back. */
  notes?: string[];
}

// fallow-ignore-next-line complexity
export async function generate(
  r: GenerateRequest,
  onWait?: (status: string) => void,
  credits?: number,
): Promise<Generated> {
  checkRequest(r);
  const route = ROUTES[r.type];
  const out = resolve(r.out);
  mkdirSync(dirname(out), { recursive: true });
  const project = projectOf(dirname(out));
  const work = mkdtempSync(join(tmpdir(), "hf-generate-"));
  try {
    const body = route.body(r, inline(work, r.masks));
    const key = idempotencyKey(route.path, [JSON.stringify(body)]);
    const job = await runJob(route.path, body, key, (id) => route.poll(encodeURIComponent(id)), {
      log: {
        projectDir: project ?? undefined,
        what: `generate ${r.type} ${relative(project ?? ".", out)}`,
      },
      onWait: (j) => onWait?.(j.status),
      timeoutMs: 30 * 60_000,
      credits,
    });
    const url = urlOf(job, route.urls);
    if (!url)
      throw new Fix(
        `HeyGen finished job ${job.id} without a file URL`,
        "run the same command again; it re-reads the job",
      );
    const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok)
      throw new Fix(
        `could not download the result (${res.status})`,
        "run the same command again; it re-reads the job",
      );
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    // HeyGen sometimes cuts inside a shot on its own; the shot is paid for and kept, the cuts are reported.
    let cuts: number[] | null | undefined;
    if (r.type === "video")
      try {
        cuts = cutsInside(out).cuts;
      } catch {
        cuts = null;
      }
    const notes: string[] = [];
    if (r.type === "video")
      try {
        const note = fitAspect(out, aspectOf(r, work));
        if (note) notes.push(note);
      } catch (e) {
        notes.push(`kept HeyGen's size, could not crop: ${e instanceof Error ? e.message : e}`);
      }
    if (r.masks?.length && r.motion)
      try {
        for (const { mask, worst } of structured(out, probeVideo(r.motion), r.masks))
          notes.push(
            `mask ${mask.box.join(",")} still shows structure in the result (${worst.toFixed(1)}x its surroundings): the text may have come back, regenerate without the guide`,
          );
      } catch {
        notes.push("could not check the masked boxes of the result");
      }
    let ledger: string | undefined;
    if (project) {
      const { recordInPlace } = await import("../media-use/lib/manifest.mjs");
      const { regenerateIndex } = await import("../media-use/lib/index-gen.mjs");
      const describe = (p?: string) =>
        p ? relative(project, resolve(p)).split("\\").join("/") : undefined;
      ledger = recordInPlace(project, {
        type: route.ledger,
        path: relative(project, out).split("\\").join("/"),
        source: "generated",
        description: r.prompt ?? r.script ?? r.type,
        provenance: {
          provider: "heygen",
          route: route.path,
          model: body.model ?? null,
          job: job.id,
          prompt: r.prompt ?? null,
          ...(r.references?.length ? { references: r.references.map(describe) } : {}),
          ...(r.firstFrame ? { first_frame: describe(r.firstFrame) } : {}),
          ...(r.photo ? { photo: describe(r.photo) } : {}),
          ...(r.audio ? { audio: describe(r.audio) } : {}),
          ...(r.motion ? { motion: describe(r.motion) } : {}),
          ...(r.masks?.length
            ? { motion_masks: r.masks.map((m) => [...m.box, ...(m.window ?? [])]) }
            : {}),
          ...(r.voice ? { voice: r.voice } : {}),
          ...(cuts !== undefined ? { cuts_inside: cuts } : {}),
        },
      }).id;
      regenerateIndex(project);
    }
    return {
      out,
      type: r.type,
      job: job.id,
      route: route.path,
      ...(ledger ? { ledger } : {}),
      ...(cuts !== undefined ? { cuts_inside: cuts } : {}),
      ...(notes.length ? { notes } : {}),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
