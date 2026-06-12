#!/usr/bin/env node
/*
 * matte.cjs — subject matting via hyperframes' built-in `remove-background`
 * (rembg-equivalent u2net_human_seg, Apache-2.0, 320×320 input, ~9 fps on
 * CoreML). Replaces the previous bundled PP-MattingV2 ONNX (34 MB asset +
 * an onnxruntime inference loop in this script): one engine, zero bundled
 * weights — the model auto-downloads once (~168 MB) to ~/.cache/hyperframes/.
 *
 * Semantics note (validated 2026-06-12 on 6 scenes + a cold-start E2E): a
 * HUMAN segmenter by intent, not surgically. Thin offset furniture (mic boom
 * arms) is usually excluded — captions render over it, behind the person —
 * but large salient objects near the subject (a telescope rig) can still
 * leak into the matte and occlude captions. Objects HELD by the subject
 * (products, phones) may drop out intermittently, letting captions pass in
 * front. Never assume: sample frames_fg/ before placing the hero.
 *
 * Pipeline:
 *   source.mp4 → hyperframes remove-background → ProRes 4444 .mov (lossless
 *   alpha; temp, deleted) → ffmpeg fps=<matte.fps> → frames_fg/f_%04d.png.
 *   frames_bg/ is extracted at the same rate (preview tooling reads it).
 *
 *   node matte.cjs <project-dir>
 * Reads:  <project>/source.mp4 (any video in the project dir is adopted)
 * Writes: <project>/frames_fg/f_%04d.png (RGBA, subject opaque),
 *         <project>/frames_bg/f_%04d.png, <project>/matte.fps
 * Env:    HYPERFRAMES_ROOT — hyperframes checkout (default ~/Downloads/hyperframes)
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const cp = require("child_process");

function hfCli() {
  const roots = [
    process.env.HYPERFRAMES_ROOT,
    path.resolve(__dirname, "..", "..", ".."), // skills/embedded-captions/scripts → repo root if in-repo
    path.join(os.homedir(), "Downloads", "hyperframes"),
  ].filter(Boolean);
  for (const root of roots) {
    const cli = path.join(root, "packages", "cli", "dist", "cli.js");
    if (fs.existsSync(cli)) return cli;
  }
  console.error("[matte] cannot find hyperframes cli — set HYPERFRAMES_ROOT to a built checkout");
  process.exit(3);
}

function ensureSource(project) {
  const src = path.join(project, "source.mp4");
  if (!fs.existsSync(src)) {
    const found = fs
      .readdirSync(project)
      .filter((f) => /\.(mp4|mov|webm|mkv)$/i.test(f) && !f.startsWith("_"))
      .map((f) => path.join(project, f))[0];
    if (!found) return src;
    try {
      fs.symlinkSync(path.basename(found), src);
    } catch {
      fs.copyFileSync(found, src);
    }
    console.log(`[matte] resolved source.mp4 -> ${path.basename(found)}`);
  }
  return src;
}

function probeFps(src) {
  try {
    const out = cp
      .execFileSync("ffprobe", [
        "-v",
        "0",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=r_frame_rate",
        "-of",
        "default=nk=1:nw=1",
        src,
      ])
      .toString()
      .trim();
    const [n, d] = out.split("/");
    const f = parseFloat(n) / parseFloat(d || "1");
    return f > 0 ? Math.max(1, Math.round(f)) : 24;
  } catch {
    return 24;
  }
}

function extractFrames(src, dst, fps, extra = []) {
  fs.mkdirSync(dst, { recursive: true });
  if (fs.readdirSync(dst).some((f) => f.endsWith(".png"))) return false;
  cp.execFileSync(
    "ffmpeg",
    ["-y", "-i", src, "-vf", `fps=${fps}`, ...extra, path.join(dst, "f_%04d.png")],
    { stdio: "ignore" },
  );
  return true;
}

function countPngs(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".png")).length;
  } catch {
    return 0;
  }
}

async function main() {
  const project = path.resolve(process.argv[2] || "");
  if (!process.argv[2]) {
    console.error("usage: matte.cjs <project-dir>");
    process.exit(1);
  }
  const src = ensureSource(project);
  if (!fs.existsSync(src)) {
    console.error(`[matte] no source video found in ${project}`);
    process.exit(2);
  }

  const fpsFile = path.join(project, "matte.fps");
  const fps = fs.existsSync(fpsFile)
    ? parseInt(fs.readFileSync(fpsFile, "utf8").replace(/\D/g, ""), 10) || probeFps(src)
    : probeFps(src);
  fs.writeFileSync(fpsFile, String(fps));

  const framesBg = path.join(project, "frames_bg");
  const framesFg = path.join(project, "frames_fg");
  if (extractFrames(src, framesBg, fps))
    console.log(`[matte] source fps=${fps} → frames_bg extracted`);

  const want = countPngs(framesBg);
  if (want > 0 && countPngs(framesFg) >= want) {
    console.log(`[matte] frames_fg already complete (${want} frames) — nothing to do`);
    return;
  }

  // 1) subject matte via hyperframes (ProRes 4444 keeps the alpha lossless)
  const mov = path.join(project, "_matte_tmp.mov");
  const t0 = Date.now();
  const cached = fs.existsSync(
    path.join(
      os.homedir(),
      ".cache",
      "hyperframes",
      "background-removal",
      "models",
      "u2net_human_seg.onnx",
    ),
  );
  console.log(
    `[matte] hyperframes remove-background (u2net_human_seg${cached ? "" : "; first run downloads ~168 MB"})…`,
  );
  const r = cp.spawnSync("node", [hfCli(), "remove-background", src, "-o", mov], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (r.status !== 0 || !fs.existsSync(mov)) {
    console.error("[matte] remove-background FAILED:");
    console.error((r.stderr || r.stdout || "").split("\n").slice(-8).join("\n"));
    process.exit(4);
  }

  // 2) burst to RGBA pngs at the project rate
  fs.mkdirSync(framesFg, { recursive: true });
  cp.execFileSync(
    "ffmpeg",
    ["-y", "-i", mov, "-vf", `fps=${fps}`, "-pix_fmt", "rgba", path.join(framesFg, "f_%04d.png")],
    { stdio: "ignore" },
  );
  fs.rmSync(mov, { force: true });

  // 3) count parity with frames_bg (fractional-rate sources can land ±1 frame:
  //    pad by duplicating the last matte frame; never let bg outrun fg)
  let got = countPngs(framesFg);
  while (got < want && got > 0) {
    fs.copyFileSync(
      path.join(framesFg, `f_${String(got).padStart(4, "0")}.png`),
      path.join(framesFg, `f_${String(got + 1).padStart(4, "0")}.png`),
    );
    got++;
  }
  console.log(
    `[matte] done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${got} frames @ ${fps}fps (bg=${want})`,
  );
}

main().catch((e) => {
  console.error("[matte]", e.message);
  process.exit(1);
});
