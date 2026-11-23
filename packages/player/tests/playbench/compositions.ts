// The two edits played, shaped like a user's 3-take and 10-take preview edits: one joined file, per take a muted
// video and an audio on it, hard cuts, 300 ms audio overlaps, 30 ms fades and gain in a data-automation lane. Seeded.

export type TakeSpec = {
  index: number;
  /** Timeline start and length of the picture, in seconds (frame-exact). */
  start: number;
  dur: number;
  /** In-point in the joined file: frame index and seconds (`inFrame / fps`, the exact style). */
  inFrame: number;
  inPoint: number;
  /** Last source frame the take may show (exclusive out-point frame index). */
  outFrame: number;
  audio: { start: number; dur: number; mediaStart: number; gain: number };
  /** The volume lane in clip-local seconds, and the same points on the timeline. */
  lane: { t: number; v: number }[];
};

export type EditSpec = {
  name: "primary" | "tentake";
  fps: number;
  file: string;
  fileDuration: number;
  duration: number;
  takes: TakeSpec[];
};

const SHAPES = {
  primary: {
    fps: 30,
    takes: 3,
    duration: 24.8,
    fileDuration: 52.27,
    firstFrames: 89,
    firstInFrame: 13,
  },
  tentake: {
    fps: 25,
    takes: 10,
    duration: 53.08,
    fileDuration: 321.12,
    firstFrames: 0,
    firstInFrame: Math.round(208.05 * 25),
  },
} as const;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FADE = 0.03;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function laneFor(clipDur: number, gain: number): { t: number; v: number }[] {
  const pts: { t: number; v: number }[] = [];
  for (let i = 0; i <= 6; i++)
    pts.push({ t: (i / 6) * FADE, v: gain * Math.sin((Math.PI / 2) * (i / 6)) });
  for (let i = 0; i <= 6; i++)
    pts.push({ t: clipDur - FADE + (i / 6) * FADE, v: gain * Math.cos((Math.PI / 2) * (i / 6)) });
  return pts.map((p) => ({ t: r3(p.t), v: r3(p.v) }));
}

export function buildEdit(name: EditSpec["name"], seed = 7): EditSpec {
  const s = SHAPES[name];
  const rand = rng(seed + (name === "tentake" ? 1000 : 0));
  const totalFrames = Math.round(s.duration * s.fps);
  const minFrames = Math.round(1.5 * s.fps);
  // Split the length into takes of random weight, each at least 1.5 s, on the frame grid.
  const frames: number[] = [];
  const weights = Array.from({ length: s.takes }, () => 0.5 + rand());
  const free = totalFrames - minFrames * s.takes;
  const wsum = weights.reduce((a, b) => a + b, 0);
  let used = 0;
  for (let i = 0; i < s.takes; i++) {
    const f =
      i === s.takes - 1 ? totalFrames - used : minFrames + Math.floor((weights[i]! / wsum) * free);
    frames.push(f);
    used += f;
  }
  if (s.firstFrames) {
    const delta = frames[0]! - s.firstFrames;
    frames[0] = s.firstFrames;
    frames[frames.length - 1] = frames[frames.length - 1]! + delta;
  }
  const fileFrames = Math.floor(s.fileDuration * s.fps);
  const taken: [number, number][] = [];
  const takes: TakeSpec[] = [];
  let startFrame = 0;
  for (let i = 0; i < s.takes; i++) {
    const d = frames[i]!;
    let inFrame = s.firstInFrame;
    // Later takes come from anywhere in the file, a second clear of every earlier take.
    for (let tries = 0; i > 0 && tries < 1000; tries++) {
      inFrame = Math.floor(s.fps * 0.5 + rand() * (fileFrames - d - s.fps));
      if (!taken.some(([a, b]) => inFrame < b + s.fps && inFrame + d > a - s.fps)) break;
    }
    taken.push([inFrame, inFrame + d]);
    const start = startFrame / s.fps;
    const dur = d / s.fps;
    const lead = i === 0 ? 0 : 0.12 + rand() * 0.013;
    const tail = i === s.takes - 1 ? 0 : 0.16 + rand() * 0.007;
    const gain = r3(1.36 + rand() * 0.68);
    const clipDur = r3(dur + lead + tail);
    takes.push({
      index: i,
      start: r3(start),
      dur: r3(dur),
      inFrame,
      inPoint: inFrame / s.fps,
      outFrame: inFrame + d,
      audio: {
        start: r3(start - lead),
        dur: clipDur,
        mediaStart: r3(inFrame / s.fps - lead),
        gain,
      },
      lane: laneFor(clipDur, gain),
    });
    startFrame += d;
  }
  return {
    name,
    fps: s.fps,
    file: `${name}.mp4`,
    fileDuration: s.fileDuration,
    duration: s.duration,
    takes,
  };
}

const WORDS =
  "so here is what we measured on this edit and why the first take plays a little long before the cut".split(
    " ",
  );

/** The composition page. `mediaBase` is where the joined files are served from. */
export function compositionHtml(edit: EditSpec, mediaBase: string): string {
  const src = `${mediaBase}/${edit.file}`;
  const media = edit.takes
    .map((t) => {
      const lane = JSON.stringify({ version: 1, lanes: [{ target: "volume", points: t.lane }] });
      return [
        `<video id="v${t.index}" class="clip" src="${src}" muted playsinline data-start="${t.start}" data-duration="${t.dur}" data-media-start="${t.inPoint}" data-track-index="${t.index * 2}"></video>`,
        `<audio id="a${t.index}" src="${src}" data-start="${t.audio.start}" data-duration="${t.audio.dur}" data-media-start="${t.audio.mediaStart}" data-volume="1" data-automation='${lane}' data-track-index="${t.index * 2 + 1}"></audio>`,
      ].join("\n      ");
    })
    .join("\n      ");
  const captions = Array.from({ length: Math.floor(edit.duration / 1.2) }, (_, i) => {
    const words = [0, 1, 2].map((k) => WORDS[(i * 3 + k) % WORDS.length]).join(" ");
    return `<div class="clip cap" data-start="${r3(i * 1.2)}" data-duration="1.1" data-track-index="${100 + i}">${words}</div>`;
  }).join("\n      ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>playbench ${edit.name}</title>
    <style>
      html, body { margin: 0; background: #000; overflow: hidden; }
      #root { position: relative; width: 720px; height: 1280px; overflow: hidden; }
      video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .cap { position: absolute; left: 0; right: 0; bottom: 160px; color: #fff; font: 700 44px system-ui, sans-serif; text-align: center; }
      #hook {
        position: absolute; left: 0; right: 0; top: 80px; color: #fff;
        font: 800 56px system-ui, sans-serif; text-align: center;
      }
    </style>
    <script src="/vendor/gsap.min.js"></script>
    <script data-hyperframes-runtime="1" src="/vendor/hyperframe.runtime.iife.js"></script>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-width="720" data-height="1280" data-duration="${edit.duration}" data-fps="${edit.fps}">
      ${media}
      <div id="hook" class="clip" data-start="0" data-duration="${edit.duration}" data-track-index="99">playbench ${edit.name}</div>
      ${captions}
    </div>
    <script>
      (function () {
        var tl = gsap.timeline({ paused: true });
        tl.fromTo("#hook", { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0);
        window.__timelines = window.__timelines || {};
        window.__timelines["main"] = tl;
      })();
    </script>
  </body>
</html>
`;
}
