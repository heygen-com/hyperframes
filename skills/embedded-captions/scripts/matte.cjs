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

function rateOf(expr) {
  const [n, d] = String(expr || "").split("/");
  const f = parseFloat(n) / parseFloat(d || "1");
  return Number.isFinite(f) && f > 0 ? f : 0;
}

// Prefer avg_frame_rate (frames/duration — the truth) over r_frame_rate (the
// container's nominal tick rate, which lies on VFR sources: a 24fps screen
// recording can carry r_frame_rate=60 and would 2.5x-desync the matte).
function probeRates(src) {
  try {
    const out = cp
      .execFileSync("ffprobe", [
        "-v",
        "0",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=r_frame_rate,avg_frame_rate",
        "-of",
        "default=nk=1:nw=1",
        "--",
        src,
      ])
      .toString()
      .trim()
      .split("\n");
    return { r: rateOf(out[0]), avg: rateOf(out[1]) };
  } catch {
    return { r: 0, avg: 0 };
  }
}

function probeFps(src) {
  const { r, avg } = probeRates(src);
  const f = avg || r;
  return f > 0 ? Math.max(1, Math.round(f)) : 24;
}

// VFR when nominal and actual disagree by >5% — the remove-background engine
// mishandles VFR timestamps (observed: 2251 fg frames vs 902 bg on one clip),
// so VFR sources get normalized to CFR before matting.
function isVfr(src) {
  const { r, avg } = probeRates(src);
  return r > 0 && avg > 0 && Math.abs(r - avg) / avg > 0.05;
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
  // read-with-catch (no exists-then-read TOCTOU): a missing/corrupt fps file
  // simply falls through to probing the source.
  let fps = 0;
  try {
    fps = parseInt(fs.readFileSync(fpsFile, "utf8").replace(/\D/g, ""), 10) || 0;
  } catch {
    /* no cached fps — probe below */
  }
  if (!fps) fps = probeFps(src);
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

  // 1) subject matte via hyperframes (ProRes 4444 keeps the alpha lossless).
  //    VFR sources are normalized to CFR first — remove-background trusts
  //    timestamps and emits a desynced frame count on VFR input (the ghost
  //    double-subject bug: the pasted matte runs at the wrong speed).
  let matteSrc = src;
  if (isVfr(src)) {
    const cfr = path.join(project, "_src_cfr.mp4");
    if (!fs.existsSync(cfr)) {
      console.log(
        `[matte] VFR source detected (nominal != actual fps) → normalizing to ${fps}fps CFR for matting`,
      );
      cp.execFileSync(
        "ffmpeg",
        [
          "-y",
          "-i",
          src,
          "-fps_mode",
          "cfr",
          "-r",
          String(fps),
          "-c:v",
          "libx264",
          "-crf",
          "16",
          "-preset",
          "fast",
          "-an",
          cfr,
        ],
        { stdio: "ignore" },
      );
    }
    matteSrc = cfr;
  }
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
    `[matte] hyperframes remove-background (u2net_human_seg${cached ? "" : "; first run downloads ~168 MB"})… model load takes ~1-2 min with no output — not hung`,
  );
  const r = cp.spawnSync("node", [hfCli(), "remove-background", matteSrc, "-o", mov], {
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

  // 3) count parity with frames_bg. Composite overlays fg by INDEX at matte.fps,
  //    so any fg/bg count mismatch is a time desync (subject ghosting). Handle
  //    BOTH directions: pad when short, linearly remap when long — and shout
  //    when the mismatch is big enough to mean broken timestamps upstream.
  let got = countPngs(framesFg);
  const tol = Math.max(2, Math.round(want * 0.01));
  if (Math.abs(got - want) > tol) {
    console.error(
      `[matte] WARN frame-count desync: fg=${got} vs bg=${want} (tolerance ${tol}). ` +
        `Reconciling by remap — if the source is VFR this run predates the CFR fix; ` +
        `delete frames_fg/ frames_bg/ matte.fps and re-run matte.cjs.`,
    );
  }
  if (got > want && want > 0) {
    // keep want frames sampled evenly across got (re-times fg onto the bg timeline)
    const keep = [];
    for (let j = 1; j <= want; j++)
      keep.push(Math.min(got, Math.max(1, Math.round((j - 0.5) * (got / want)))));
    const tmp = path.join(project, "_fg_remap");
    fs.mkdirSync(tmp, { recursive: true });
    keep.forEach((srcIdx, k) => {
      fs.copyFileSync(
        path.join(framesFg, `f_${String(srcIdx).padStart(4, "0")}.png`),
        path.join(tmp, `f_${String(k + 1).padStart(4, "0")}.png`),
      );
    });
    fs.rmSync(framesFg, { recursive: true, force: true });
    fs.renameSync(tmp, framesFg);
    got = countPngs(framesFg);
  }
  while (got < want && got > 0) {
    fs.copyFileSync(
      path.join(framesFg, `f_${String(got).padStart(4, "0")}.png`),
      path.join(framesFg, `f_${String(got + 1).padStart(4, "0")}.png`),
    );
    got++;
  }
  console.log(
    `[matte] done in ${((Date.now() - t0) / 1000).toFixed(1)}s → fg=${got} bg=${want} @ ${fps}fps${got === want ? " (parity ok)" : ""}`,
  );
}

main().catch((e) => {
  console.error("[matte]", e.message);
  process.exit(1);
});
