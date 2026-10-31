// A re-shot person never matches the original by pixels, so pixels do not judge them. Three gates do: the framing
// is clearly wrong (face centre or height off the original's, per shot), the generated clip carries the original's
// words (its motion guide's text came along), or the lips are out of sync. The rest (motion energy, look, whether
// each generated clip starts at one of the original's cuts) is reported, not judged.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contrast } from "./drawn.js";
import { faceBoxes } from "./face.js";
import { pearson, probeVideo, round, runFfmpeg, type Roi, type VideoInfo } from "./media.js";
import { avSync, type SyncResult } from "./sync.js";

/** A shot's framing is clearly wrong when, by the shot's medians, the face centre sits over FRAMING_SHIFT face heights
 * from the original's or its height is outside FRAMING_SCALE of it. Faces at FACE_RATE a second; shorter shots than
 * FRAMING_MIN_S have too few faces to judge. */
const FRAMING_SHIFT = 0.3;
const FRAMING_SCALE: [number, number] = [0.8, 1.25];
const FRAMING_MIN_S = 1;
const FRAMING_MIN_FACES = 3;
const FACE_RATE = 4;
/** Picture against sound (positive: the picture is late), the broadcast tolerance; judged on high confidence only. */
const SYNC_MS: [number, number] = [-125, 45];
const SYNC_MIN_S = 2;
const SYNC_MIN_SPEECH = 0.3;
/** A clip carries a drawn element's text when, of the original's sharp ink (over TEXT_CONTRAST) that differs by
 * DRAWN_DIFF from the clean still and where yours draws over the clip, the share the clip matches within two pixels in
 * colour (TEXT_COLOUR) reaches CARRIED_TEXT; the clip shares person and place, so only carried letters match. */
const CARRIED_TEXT = 0.35;
const TEXT_CONTRAST = 140;
const DRAWN_DIFF = 60;
const TEXT_COLOUR = 15;
const TEXT_MIN_INK = 50;
const CARRIED_SAMPLES = 8;
/** A generated clip found by its sound needs this correlation with the original's; it starts at a cut within this. */
const LOCATE_MIN = 0.6;
export const AT_CUT_S = 0.1;
const ENVELOPE_RATE = 100;

export interface GeneratedClip {
  /** As the ledger writes it, relative to the project. */
  path: string;
  /** The still it was made from (a clean frame of the original), relative to the project. */
  reference?: string;
  /** Film time of the clip's first frame, and how well its sound matched the original's there. */
  offset?: number;
  match?: number;
  window?: [number, number];
  /** Where the film shows it: film window, the clip's time at its start, and its playback rate. */
  uses?: ClipUse[];
  /** Whether it starts within AT_CUT_S of the film's start or one of the original's cuts. */
  at_cut?: boolean;
  note?: string;
}

export interface ClipUse {
  window: [number, number];
  from: number;
  rate: number;
}

export interface ShotFraming {
  window: [number, number];
  /** Medians: face centre distance in the original's face heights, and yours' face height over the original's. */
  shift: number;
  scale: number;
  pass: boolean;
}

export interface CarriedText {
  drawn: string;
  clip: string;
  window: [number, number];
  /** How well the generated clip's ink inside the box matches the original's text there. */
  score: number;
  carried: boolean;
}

export interface PersonVerdict {
  /** Each gate: false when it fails, null when it could not be measured. */
  gates: { framing: boolean | null; text: boolean | null; sync: boolean | null };
  pass: boolean | null;
  framing?: ShotFraming[];
  text?: CarriedText[];
  sync?: {
    window: [number, number];
    lag_ms: number | null;
    original_lag_ms: number | null;
    confidence: string;
    pass: boolean | null;
  }[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The ledger's generated videos (HeyGen), with the film window it records when it does. */
export function generatedClips(ledger: string): GeneratedClip[] {
  // fallow-ignore-next-line complexity
  return ledger.split("\n").flatMap((line) => {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return [];
    }
    if (!isRecord(entry) || entry.type !== "video" || typeof entry.path !== "string") return [];
    const p = entry.provenance;
    if (!isRecord(p) || p.provider !== "heygen") return [];
    const w = Array.isArray(p.window) ? p.window.filter((v) => typeof v === "number") : [];
    const refs = Array.isArray(p.references)
      ? p.references.filter((v) => typeof v === "string")
      : [];
    return [
      {
        path: entry.path,
        ...(refs[0] ? { reference: refs[0] } : {}),
        ...(w.length === 2 ? { offset: w[0]!, window: [w[0]!, w[1]!] as [number, number] } : {}),
      },
    ];
  });
}

/** Loudness every 10 ms of a file's sound. */
function envelope(path: string): number[] {
  const raw = runFfmpeg([...["-i", path, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "-"]]);
  const s = new Float32Array(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + (raw.byteLength & ~3)),
  );
  const step = 8000 / ENVELOPE_RATE;
  const out: number[] = [];
  for (let i = 0; i + step <= s.length; i += step) {
    let e = 0;
    for (let j = i; j < i + step; j++) e += s[j]! ** 2;
    out.push(Math.sqrt(e / step));
  }
  return out;
}

/**
 * Where `b` sits inside `a` (index of a where b[0] lands) and the correlation there, over lags that keep at least
 * nine tenths of b inside a.
 */
function bestLag(a: number[], b: number[]): { lag: number; r: number } {
  let best = { lag: 0, r: -2 };
  const keep = Math.ceil(0.9 * b.length);
  for (let lag = -(b.length - keep); lag <= a.length - keep; lag++) {
    const [i0, i1] = [Math.max(0, -lag), Math.min(b.length, a.length - lag)];
    const n = i1 - i0;
    if (n < Math.max(50, keep)) continue;
    const r = pearson(a.slice(i0 + lag, i1 + lag), b.slice(i0, i1)) ?? -2;
    if (r > best.r) best = { lag, r };
  }
  return best;
}

/** Each generated clip on the film: it starts at the ledger's window, else where its sound lines up with the original,
 * and shows where the timeline's `uses` place it (by path), else over its whole window. Paths resolve in the project */
export function placeClips(
  clips: GeneratedClip[],
  project: string | undefined,
  ref: VideoInfo,
  cuts: number[],
  shown: Map<string, ClipUse[]> = new Map(),
): (GeneratedClip & { file?: string; info?: VideoInfo; still?: string })[] {
  let whole: number[] | undefined;
  // fallow-ignore-next-line complexity
  return clips.map((c) => {
    const file = project ? join(project, c.path) : undefined;
    let info: VideoInfo | undefined;
    try {
      info = file ? probeVideo(file) : undefined;
    } catch {
      info = undefined;
    }
    if (!info || !file) return { ...c, note: "the clip's file is not in the project" };
    const uses = shown.get(normalize(c.path));
    let placed: GeneratedClip = c;
    if (c.offset === undefined && info.audio && ref.audio) {
      whole ??= envelope(ref.path);
      const { lag, r } = bestLag(whole, envelope(file));
      const offset = round(lag / ENVELOPE_RATE + ref.audioStart - info.audioStart, 3);
      placed =
        r >= LOCATE_MIN
          ? { ...c, offset, match: round(r, 2) }
          : { ...c, match: round(r, 2), note: "its sound does not match the original's" };
    }
    if (placed.offset === undefined && uses?.length)
      placed = { ...placed, offset: round(uses[0]!.window[0] - uses[0]!.from / uses[0]!.rate, 3) };
    if (placed.offset === undefined)
      return {
        ...placed,
        file,
        info,
        note: placed.note ?? "no window in the ledger, no sound and no place in the project",
      };
    const offset = placed.offset;
    const end = Math.min(ref.pictureDuration, offset + info.pictureDuration);
    return {
      ...placed,
      window: placed.window ?? [round(Math.max(0, offset), 3), round(end, 3)],
      uses: uses ?? [
        {
          window: [round(Math.max(0, offset), 3), round(end, 3)],
          from: Math.max(0, -offset),
          rate: 1,
        },
      ],
      at_cut: [0, ...cuts].some((t) => Math.abs(t - offset) <= AT_CUT_S),
      file,
      info,
      ...(c.reference && existsSync(join(project!, c.reference))
        ? { still: join(project!, c.reference) }
        : {}),
    };
  });
}

/** Where a project's timeline shows each video file, by project-relative path. */
export async function clipUses(project: string): Promise<Map<string, ClipUse[]>> {
  const out = new Map<string, ClipUse[]>();
  const index = join(project, "index.html");
  if (!existsSync(index)) return out;
  const [{ ensureDOMParser }, { describeProject }] = await Promise.all([
    import("../utils/dom.js"),
    import("../timeline/describeProject.js"),
  ]);
  ensureDOMParser();
  const timeline = await describeProject(index);
  for (const row of timeline.tracks.find((t) => t.kind === "video")?.rows ?? []) {
    if (!row.src || row.absEnd <= row.absStart) continue;
    const key = normalize(row.src);
    const use = {
      window: [round(row.absStart, 3), round(row.absEnd, 3)] as [number, number],
      from: row.mediaStart ?? 0,
      rate: row.playbackRate ?? 1,
    };
    out.set(key, [...(out.get(key) ?? []), use]);
  }
  return out;
}

/** A project-relative path written one way. */
const normalize = (p: string) => p.replace(/^\.\//, "").replace(/\\/g, "/");

/** RGB crops of one box at these times: the picture scaled to cover `w`x`h` (the original's size) first. */
function boxAt(
  info: VideoInfo,
  times: number[],
  box: Roi,
  w: number,
  h: number,
): (Uint8Array | undefined)[] {
  const ks = times.map((t) => Math.max(0, Math.min(info.frames - 1, Math.round(t * info.fps))));
  const unique = [...new Set(ks)].sort((x, y) => x - y);
  const work = mkdtempSync(join(tmpdir(), "hf-person-"));
  try {
    const filters = [
      `select=${unique.map((k) => `eq(n\\,${k})`).join("+")}`,
      `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic`,
      `crop=${w}:${h}`,
      `crop=${box[2]}:${box[3]}:${box[0]}:${box[1]}`,
      "format=rgb24",
    ].join(",");
    runFfmpeg(
      [
        ...["-i", info.path, "-an", "-vf", filters, "-fps_mode", "passthrough"],
        ...["-f", "rawvideo", "out.rgb"],
      ],
      undefined,
      work,
    );
    const raw = readFileSync(join(work, "out.rgb"));
    const size = box[2] * box[3] * 3;
    return ks.map((k) => {
      const i = unique.indexOf(k) * size;
      return i + size <= raw.length ? raw.subarray(i, i + size) : undefined;
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Within `r` pixels of (x, y), some pixel passes `test`. */
function nearby(
  w: number,
  h: number,
  x: number,
  y: number,
  r: number,
  test: (k: number) => boolean,
) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const [xx, yy] = [Math.min(w - 1, Math.max(0, x + dx)), Math.min(h - 1, Math.max(0, y + dy))];
      if (test(yy * w + xx)) return true;
    }
  return false;
}

const dist = (p: Uint8Array, i: number, q: Uint8Array, k: number) =>
  Math.hypot(p[i * 3]! - q[k * 3]!, p[i * 3 + 1]! - q[k * 3 + 1]!, p[i * 3 + 2]! - q[k * 3 + 2]!);

/** One frame: the share of the original's letters (apart from the still and from what yours draws) the clip shows. */
// fallow-ignore-next-line complexity
export function carriedFrame(
  original: Uint8Array,
  clip: Uint8Array,
  still: Uint8Array | undefined,
  w: number,
  h: number,
  yours: Uint8Array | undefined,
): number | null {
  const [sharp, inked] = [contrast(original, w, h), contrast(clip, w, h)];
  let [n, hit] = [0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (sharp[i]! <= TEXT_CONTRAST) continue;
      if (still && !nearby(w, h, x, y, 2, (k) => dist(original, k, still, k) > DRAWN_DIFF))
        continue;
      if (yours && !nearby(w, h, x, y, 2, (k) => dist(yours, k, clip, k) > DRAWN_DIFF)) continue;
      n++;
      const same = (k: number) =>
        inked[k]! > TEXT_CONTRAST && dist(original, i, clip, k) < TEXT_COLOUR;
      if (nearby(w, h, x, y, 2, same)) hit++;
    }
  return n >= TEXT_MIN_INK ? hit / n : null;
}

/** One box of a still picture, scaled to cover `w`x`h` (the original's size) first. */
function stillBox(path: string, box: Roi, w: number, h: number): Uint8Array | undefined {
  try {
    const raw = runFfmpeg([
      ...["-i", path, "-frames:v", "1", "-vf"],
      `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h},crop=${box[2]}:${box[3]}:${box[0]}:${box[1]},format=rgb24`,
      ...["-f", "rawvideo", "-"],
    ]);
    return raw.length >= box[2] * box[3] * 3 ? new Uint8Array(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a generated clip alone carries the original's text inside a drawn element's box over its window: a clean
 * clip shows the person and place behind the letters, one made from a motion guide with words on it shows the words. */
function carriedText(
  ref: VideoInfo,
  yours: VideoInfo,
  clip: { path: string; info: VideoInfo; uses: ClipUse[]; still?: string },
  drawn: { id: string; box: Roi; window: [number, number] },
): CarriedText | undefined {
  // The film times both show, each with the clip's own time there.
  const spans = clip.uses.flatMap((u) => {
    const [a, b] = [Math.max(drawn.window[0], u.window[0]), Math.min(drawn.window[1], u.window[1])];
    return b - a >= 1 / ref.fps ? [{ a, b, u }] : [];
  });
  const total = spans.reduce((s, x) => s + x.b - x.a, 0);
  if (!total) return undefined;
  // Evenly spread samples over the shown spans.
  const times = Array.from({ length: CARRIED_SAMPLES }, (_, i) => {
    let at = ((i + 0.5) * total) / CARRIED_SAMPLES;
    for (const x of spans) {
      if (at <= x.b - x.a)
        return { t: x.a + at, c: x.u.from + (at + x.a - x.u.window[0]) * x.u.rate };
      at -= x.b - x.a;
    }
    const x = spans.at(-1)!;
    return { t: x.b, c: x.u.from + (x.b - x.u.window[0]) * x.u.rate };
  });
  const orig = boxAt(
    ref,
    times.map((x) => x.t),
    drawn.box,
    ref.width,
    ref.height,
  );
  const generated = boxAt(
    clip.info,
    times.map((x) => x.c),
    drawn.box,
    ref.width,
    ref.height,
  );
  const mine = boxAt(
    yours,
    times.map((x) => x.t),
    drawn.box,
    ref.width,
    ref.height,
  );
  const still = clip.still ? stillBox(clip.still, drawn.box, ref.width, ref.height) : undefined;
  const scores = orig.flatMap((o, i) => {
    const g = generated[i];
    const s = o && g ? carriedFrame(o, g, still, drawn.box[2], drawn.box[3], mine[i]) : null;
    return s === null ? [] : [s];
  });
  if (!scores.length) return undefined;
  const score = scores.reduce((s, v) => s + v, 0) / scores.length;
  return {
    drawn: drawn.id,
    clip: clip.path,
    window: [round(spans[0]!.a, 3), round(spans.at(-1)!.b, 3)],
    score: round(score, 3),
    carried: score >= CARRIED_TEXT,
  };
}

const median = (v: number[]) => [...v].sort((x, y) => x - y)[v.length >> 1]!;

const centre = (b: number[]) => [b[0]! + b[2]! / 2, b[1]! + b[3]! / 2] as const;

/** The original's shots inside a window: split at its cuts. */
function shotsIn(window: [number, number], cuts: number[]): [number, number][] {
  const edges = [window[0], ...cuts.filter((t) => t > window[0] && t < window[1]), window[1]];
  return edges.slice(1).map((e, i) => [edges[i]!, e]);
}

/** One shot's framing from both sides' faces at the same moments (boxes as shares of an `aspect`-wide frame): the
 * original's largest face against yours' nearest, by the shot's medians, so one stray detection (a photo) can't. */
export function shotFraming(
  window: [number, number],
  original: { t: number; boxes: number[][] }[],
  yours: { t: number; boxes: number[][] }[],
  aspect = 1,
): ShotFraming | undefined {
  const inside = (s: { t: number }) => s.t >= window[0] && s.t < window[1];
  // Across, a share of the frame is `aspect` times longer than down.
  const apart = (b: number[], x: number, y: number) =>
    Math.hypot((centre(b)[0] - x) * aspect, centre(b)[1] - y);
  const [a, b] = [original.filter(inside), yours.filter(inside)];
  const moments = a.flatMap((o, i) => {
    const y = b[i];
    if (!o.boxes.length || !y?.boxes.length) return [];
    const subject = o.boxes.reduce((p, q) => (q[3]! > p[3]! ? q : p));
    const [ox, oy] = centre(subject);
    const near = y.boxes.reduce((p, q) => (apart(q, ox, oy) < apart(p, ox, oy) ? q : p));
    return [{ shift: apart(near, ox, oy) / subject[3]!, scale: near[3]! / subject[3]! }];
  });
  if (moments.length < FRAMING_MIN_FACES) return undefined;
  const shift = round(median(moments.map((m) => m.shift)), 3);
  const scale = round(median(moments.map((m) => m.scale)), 3);
  return {
    window: [round(window[0], 3), round(window[1], 3)],
    shift,
    scale,
    pass: shift <= FRAMING_SHIFT && scale >= FRAMING_SCALE[0] && scale <= FRAMING_SCALE[1],
  };
}

/** Lips in sync: the lag inside SYNC_MS, judged only when the reading is confident (it is a motion proxy). */
export function syncPass(r: Pick<SyncResult, "best_lag_ms" | "confidence">): boolean | null {
  if (r.confidence !== "high" || r.best_lag_ms === null) return null;
  return r.best_lag_ms >= SYNC_MS[0] && r.best_lag_ms <= SYNC_MS[1];
}

/** A segment's person: framing per shot, carried text per drawn element, lip sync per long speaking shot. */
export async function personVerdict(opts: {
  ref: VideoInfo;
  yours: VideoInfo;
  window: [number, number];
  cuts: number[];
  clips: (GeneratedClip & { info?: VideoInfo; still?: string })[];
  drawn: { id: string; box: Roi; window: [number, number] }[];
}): Promise<PersonVerdict> {
  const { ref, yours, window } = opts;
  const shots = shotsIn(window, opts.cuts);
  const n = Math.max(2, Math.round((window[1] - window[0]) * FACE_RATE));
  // A face inside a drawn element (a photo on a card) is not the person.
  const drawnFace = (t: number, b: number[]) =>
    opts.drawn.some(({ box: [x, y, w, h], window: [a, z] }) => {
      const [cx, cy] = [(b[0]! + b[2]! / 2) * ref.width, (b[1]! + b[3]! / 2) * ref.height];
      return t >= a && t < z && cx >= x && cx < x + w && cy >= y && cy < y + h;
    });
  const people = (samples: Awaited<ReturnType<typeof faceBoxes>>) =>
    samples.map((f) => ({ ...f, boxes: f.boxes.filter((b) => !drawnFace(f.t, b)) }));
  const [fo, fy] = [
    people(await faceBoxes(ref, window[0], window[1], n)),
    people(await faceBoxes(yours, window[0], window[1], n)),
  ];
  const framing = shots.flatMap((s) =>
    s[1] - s[0] >= FRAMING_MIN_S
      ? [shotFraming(s, fo, fy, ref.width / ref.height)].filter((f) => f !== undefined)
      : [],
  );
  const text = opts.drawn.flatMap((d) =>
    opts.clips.flatMap((c) =>
      c.info && c.uses
        ? [
            carriedText(
              ref,
              yours,
              { path: c.path, info: c.info, uses: c.uses, still: c.still },
              d,
            ),
          ].filter((t) => t !== undefined)
        : [],
    ),
  );
  const sync = shots.flatMap((s) => {
    if (s[1] - s[0] < SYNC_MIN_S || !yours.audio) return [];
    const mouth = (
      info: VideoInfo,
      samples: { t: number; boxes: number[][] }[],
    ): Roi | undefined => {
      const boxes = samples
        .filter((f) => f.t >= s[0] && f.t < s[1] && f.boxes.length)
        .map((f) => f.boxes.reduce((x, y) => (y[3]! > x[3]! ? y : x)));
      if (boxes.length < FRAMING_MIN_FACES) return undefined;
      const [x, y, w, h] = [0, 1, 2, 3].map((i) => median(boxes.map((b) => b[i]!)));
      const roi: Roi = [
        Math.round(((x! + 0.2 * w!) * info.width) / 2) * 2,
        Math.round(((y! + 0.62 * h!) * info.height) / 2) * 2,
        Math.max(8, Math.round((0.6 * w! * info.width) / 2) * 2),
        Math.max(8, Math.round((0.38 * h! * info.height) / 2) * 2),
      ];
      return roi[0] + roi[2] <= info.width && roi[1] + roi[3] <= info.height ? roi : undefined;
    };
    const [mo, my] = [mouth(ref, fo), mouth(yours, fy)];
    if (!my) return [];
    const mine = avSync(yours, my, s[0], s[1]);
    if (mine.speech_active_fraction < SYNC_MIN_SPEECH) return [];
    const theirs = mo && ref.audio ? avSync(ref, mo, s[0], s[1]) : undefined;
    return [
      {
        window: [round(s[0], 3), round(s[1], 3)] as [number, number],
        lag_ms: mine.best_lag_ms,
        original_lag_ms: theirs?.best_lag_ms ?? null,
        confidence: mine.confidence,
        pass: syncPass(mine),
      },
    ];
  });
  const gate = (v: (boolean | null)[]) =>
    v.includes(false) ? false : v.some((p) => p === true) ? true : null;
  const gates = {
    framing: gate(framing.map((f) => f.pass)),
    text: gate(text.map((t) => !t.carried)),
    sync: gate(sync.map((s) => s.pass)),
  };
  const all = Object.values(gates);
  return {
    gates,
    pass: all.includes(false) ? false : all.some((g) => g === true) ? true : null,
    ...(framing.length ? { framing } : {}),
    ...(text.length ? { text } : {}),
    ...(sync.length ? { sync } : {}),
  };
}
