// Long-form render fixtures (spec §8). Run from a scratch directory that
// already contains assets/long.mp4 (see README.md for the ffmpeg command).
//   DUR=300 node gen.mjs        # 5-minute fixtures (default)
//   DUR=2400 node gen.mjs       # 40-minute soak fixtures
import { mkdirSync, writeFileSync, linkSync, existsSync } from "node:fs";

const W = 1920;
const H = 1080;
const DUR = Number(process.env.DUR ?? "300");
if (!Number.isFinite(DUR) || DUR <= 0)
  throw new Error(`DUR must be a positive number, got ${process.env.DUR}`);
if (!existsSync("assets/long.mp4")) throw new Error("assets/long.mp4 missing; see README.md");

const comp = (
  body,
) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#000}video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}#badge{position:absolute;right:40px;top:40px;font:700 64px sans-serif;color:#fff;background:rgba(0,0,0,.5);padding:8px 24px}</style></head><body>
<div id="root" data-composition-id="root" data-width="${W}" data-height="${H}" data-start="0" data-duration="${DUR}" data-no-timeline>
${body}
<div id="badge">overlay</div>
</div></body></html>`;

const single = () =>
  comp(
    `<video class="clip" id="v0" src="assets/long.mp4" data-start="0" data-duration="${DUR}" data-media-start="0" data-has-audio="true"></video>`,
  );

const clips = (n = 60) =>
  comp(
    Array.from({ length: n }, (_, i) => {
      const d = DUR / n;
      return `<video class="clip" id="v${i}" src="assets/long.mp4" data-start="${(i * d).toFixed(3)}" data-duration="${d.toFixed(3)}" data-media-start="${(i * d).toFixed(3)}" data-has-audio="true"></video>`;
    }).join("\n"),
  );

for (const [name, html] of Object.entries({ "a-single": single(), "c-clips60": clips() })) {
  mkdirSync(`${name}/assets`, { recursive: true });
  writeFileSync(`${name}/index.html`, html);
  if (!existsSync(`${name}/assets/long.mp4`)) linkSync("assets/long.mp4", `${name}/assets/long.mp4`);
  writeFileSync(
    `${name}/hyperframes.json`,
    JSON.stringify({ name, fps: 30, width: W, height: H }, null, 2),
  );
}
console.log(`generated a-single c-clips60 (DUR=${DUR}s)`);
