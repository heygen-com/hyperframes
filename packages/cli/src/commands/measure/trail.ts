// Motion as one picture, for an agent that reads still images: the frames of a window laid over each other as an
// onion skin (earliest faintest), the moving part's path with numbered points, and a heat map of where the picture
// changed. One look tells a slide from a scale from a mask reveal; `keyframes --shot` does the same for a project.
import { join } from "node:path";
import { defineCommand } from "citty";
import type { Example } from "../_examples.js";
import {
  jsonArg,
  num,
  outArg,
  roiArg,
  runMeasure,
  videoAndRoi,
  videoArg,
  window,
} from "../../measure/command.js";
import { Fix, grey, outDir, readClip, round, videoClip, writeImage } from "../../measure/media.js";

export const examples: Example[] = [
  [
    "How a title enters between 2.1 s and 2.9 s",
    "hyperframes measure trail ref.mp4 --from 2.1 --to 2.9",
  ],
  [
    "One card's path, 10 ghosts",
    "hyperframes measure trail ref.mp4 --from 4 --to 5.2 --roi 300,200,900,600 --ghosts 10",
  ],
];

const WORK_W = 640;
// Grey bytes the heat map may hold at once.
const GREY_BUDGET = 256 * 1024 * 1024;
const MOVING = 24;
// 3x5 digits, drawn without a font so the picture comes out the same on every machine.
const DIGITS = [
  "111101101101111",
  "010110010010111",
  "111001111100111",
  "111001111001111",
  "101101111001001",
  "111100111001111",
  "111100111101111",
  "111001001001001",
  "111101111101111",
  "111101111001111",
];

function put(px: Uint8Array, w: number, h: number, x: number, y: number, rgb: number[]) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  px.set(rgb, (y * w + x) * 3);
}

function dot(
  px: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  rgb: number[],
) {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r) put(px, w, h, Math.round(cx + x), Math.round(cy + y), rgb);
}

function line(
  px: Uint8Array,
  w: number,
  h: number,
  [x0, y0]: number[],
  [x1, y1]: number[],
  rgb: number[],
) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1! - x0!, y1! - y0!)));
  for (let i = 0; i <= n; i++)
    dot(px, w, h, x0! + ((x1! - x0!) * i) / n, y0! + ((y1! - y0!) * i) / n, 1, rgb);
}

function digits(
  px: Uint8Array,
  w: number,
  h: number,
  text: string,
  x: number,
  y: number,
  s: number,
) {
  [...text].forEach((ch, i) => {
    const g = DIGITS[Number(ch)] ?? "";
    for (let k = 0; k < g.length; k++)
      if (g[k] === "1")
        for (let yy = 0; yy < s; yy++)
          for (let xx = 0; xx < s; xx++)
            put(
              px,
              w,
              h,
              x + (i * 4 + (k % 3)) * s + xx,
              y + Math.floor(k / 3) * s + yy,
              [255, 255, 255],
            );
  });
}

/** Per pixel, the median of the frames' grey: the still background the moving part passes over. */
function medianGrey(gs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(gs[0]!.length);
  const v = new Array<number>(gs.length);
  for (let i = 0; i < out.length; i++) {
    for (let k = 0; k < gs.length; k++) v[k] = gs[k]![i]!;
    v.sort((a, b) => a - b);
    out[i] = v[gs.length >> 1]!;
  }
  return out;
}

const heat = (u: number): number[] =>
  u < 0.5
    ? [Math.round(510 * u), 0, 0]
    : [255, Math.round(510 * (u - 0.5)), Math.round(Math.max(0, 255 * (u - 0.8) * 5))];

export default defineCommand({
  meta: {
    name: "trail",
    description:
      "Motion as one picture: an onion skin of a window's frames, the moving part's path, and a heat map of where it changed",
  },
  args: {
    video: videoArg,
    from: { type: "string", description: "First second", required: true },
    to: { type: "string", description: "Last second", required: true },
    ghosts: { type: "string", description: "Frames laid over each other (default 8)" },
    roi: roiArg,
    out: outArg,
    json: jsonArg,
  },
  async run({ args }) {
    // fallow-ignore-next-line complexity
    await runMeasure(() => {
      const { info, roi } = videoAndRoi(args.video, args.roi);
      const [a, b] = window(info, args.from, args.to, ["--from", "--to"]);
      const count = Math.max(2, num(args.ghosts, "--ghosts", 8));
      const width = Math.min(WORK_W, roi[2]);
      const n = Math.max(0, Math.round((b - a) * info.fps));
      if (n < 2) throw new Fix(`under 2 frames between ${a}s and ${b}s`, "widen --from/--to");
      // The heat map reads every frame, grey; a long window is read every nth frame to stay within GREY_BUDGET.
      const outH = Math.max(2, Math.round((roi[3] * width) / roi[2] / 2) * 2);
      const nth = Math.ceil((n * width * outH) / GREY_BUDGET);
      const clip = videoClip(info.path, a, b - a, info);
      const every = [`select=not(mod(n\\,${nth}))`, `setpts=N/(${info.fpsText})/TB`];
      const all = readClip(nth > 1 ? { ...clip, filters: every } : clip, {
        roi,
        width,
        gray: true,
      });
      const { w, h } = all;
      const gs = all.frames;
      const picks = [
        ...new Set(
          Array.from({ length: count }, (_, i) => Math.round((i * (n - 1)) / (count - 1))),
        ),
      ];
      // Colour for the ghosts alone, picked by index from one decode.
      const colour = readClip(
        {
          ...clip,
          filters: [
            `select=${picks.map((k) => `eq(n\\,${k})`).join("+")}`,
            `setpts=N/(${info.fpsText})/TB`,
          ],
        },
        { roi, width },
      ).frames;
      const ghostGrey = colour.map(grey);
      const base = medianGrey(ghostGrey);

      // The onion skin: the background dimmed, each ghost's moving pixels over it, later ones stronger.
      const skin = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) skin.fill(Math.round(base[i]! * 0.45), i * 3, i * 3 + 3);
      const [kx, ky] = [roi[2] / w, roi[3] / h];
      const path = picks.map((fi, order) => {
        const alpha = 0.3 + (0.7 * order) / Math.max(1, picks.length - 1);
        const [f, g] = [colour[order]!, ghostGrey[order]!];
        let [sx, sy, n] = [0, 0, 0];
        for (let i = 0; i < w * h; i++) {
          if (Math.abs(g[i]! - base[i]!) <= MOVING) continue;
          for (let c = 0; c < 3; c++)
            skin[i * 3 + c] = Math.round(skin[i * 3 + c]! * (1 - alpha) + f[i * 3 + c]! * alpha);
          sx += i % w;
          sy += Math.floor(i / w);
          n++;
        }
        const t = round(a + fi / info.fps, 3);
        return n
          ? { t, x: sx / n, y: sy / n, share: n / (w * h) }
          : { t, x: null, y: null, share: 0 };
      });
      const seen = path.flatMap((p, i) =>
        p.x !== null && p.y !== null ? [{ ...p, x: p.x, y: p.y, i }] : [],
      );
      for (let i = 1; i < seen.length; i++)
        line(
          skin,
          w,
          h,
          [seen[i - 1]!.x, seen[i - 1]!.y],
          [seen[i]!.x, seen[i]!.y],
          [255, 200, 40],
        );
      const scale = Math.max(1, Math.round(w / 320));
      for (const p of seen) {
        dot(skin, w, h, p.x, p.y, 2 + scale, [255, 60, 60]);
        digits(
          skin,
          w,
          h,
          String(p.i + 1),
          Math.round(p.x) + 4 + scale,
          Math.round(p.y) - 6 * scale,
          scale,
        );
      }

      // The heat map: every frame's change from the one before, summed, over the dimmed first frame.
      const sum = new Float32Array(w * h);
      for (let k = 1; k < gs.length; k++)
        for (let i = 0; i < w * h; i++) sum[i]! += Math.abs(gs[k]![i]! - gs[k - 1]![i]!);
      const top = sum.reduce((m, v) => Math.max(m, v), 0) || 1;
      const map = new Uint8Array(w * h * 3);
      let [x0, y0, x1, y1] = [w, h, -1, -1];
      for (let i = 0; i < w * h; i++) {
        const u = Math.min(1, sum[i]! / top);
        const [r, g, bl] = heat(u);
        const under = gs[0]![i]! * 0.35;
        map.set(
          [Math.max(r!, under), Math.max(g!, under), Math.max(bl!, under)].map(Math.round),
          i * 3,
        );
        if (u > 0.15) {
          const [x, y] = [i % w, Math.floor(i / w)];
          [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
        }
      }

      const dir = outDir(args.out, "measure/trail");
      const name = `trail-${a}-${b}s`;
      const first = seen[0];
      const final = seen.at(-1);
      return {
        video: info.path,
        from: a,
        to: b,
        frames: n,
        ...(nth > 1 ? { heat_every_nth_frame: nth } : {}),
        ghosts: picks.length,
        trail: writeImage(join(dir, `${name}.png`), skin, w, h),
        heat: writeImage(join(dir, `${name}-heat.png`), map, w, h),
        path: path.map((p, i) => ({
          n: i + 1,
          t: p.t,
          ...(p.x !== null && p.y !== null
            ? {
                x: Math.round(roi[0] + p.x * kx),
                y: Math.round(roi[1] + p.y * ky),
                moving_share: round(p.share, 3),
              }
            : { moving_share: 0 }),
        })),
        ...(first && final
          ? {
              net_move: {
                dx: Math.round((final.x - first.x) * kx),
                dy: Math.round((final.y - first.y) * ky),
              },
              size_ratio: round(final.share / (first.share || 1e-9), 2),
            }
          : {}),
        changed_box:
          x1 >= 0
            ? [roi[0] + x0 * kx, roi[1] + y0 * ky, (x1 - x0 + 1) * kx, (y1 - y0 + 1) * ky].map(
                Math.round,
              )
            : null,
        reading:
          "ghosts fade from first (faint) to last (solid); numbered red points are the moving part's centre; in the heat map white-yellow changed most",
      };
    });
  },
});
