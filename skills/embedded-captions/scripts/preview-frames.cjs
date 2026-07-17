#!/usr/bin/env node
/*
 * preview-frames.cjs — APPROXIMATE final frames in seconds, without rendering.
 *
 *   node preview-frames.cjs <project-dir> [t1 t2 ...]
 *
 * For each sample time t: screenshot the caption layer(s) in headless Chromium
 * (index.html seeked to t; rail.html too if present), then composite in sharp:
 *   frames_bg[t]  →  index captions (embed layer)  →  matte frames_fg[t] (subject
 *   occludes the embed)  →  rail captions (in front, like the final alpha-overlay)
 * = a faithful preview of the composite for THAT moment, ~2s per frame instead of
 * a multi-minute render. Writes <project>/preview/t<t>.png + a contact sheet
 * preview/sheet.png.
 *
 * Use it BEFORE rendering: eyeball placement, occlusion, washout, text-on-text —
 * the failure classes the geometric gates can't judge. The QA checklist lives in
 * SKILL.md § Visual QA. (Video elements show poster/first-frame in the screenshot;
 * the REAL a-roll pixels come from frames_bg, so previews stay accurate.)
 *
 * Sample-time default: climax/groups midpoints from standard.json or plan.json,
 * else 25/50/75% of the clip.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");

function stripGsapSri(html) {
  return html.replace(/<script\b[^>]*\bsrc=["'][^"']*gsap[^"']*["'][^>]*>/gi, (tag) =>
    tag
      .replace(/\s+integrity\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
      .replace(/\s+crossorigin\s*=\s*(?:"[^"]*"|'[^']*')/gi, ""),
  );
}

const HF_ROOTS = [
  process.env.HYPERFRAMES_ROOT,
  path.resolve(__dirname, "../../.."),
  path.join(os.homedir(), "Downloads", "hyperframes"),
].filter(Boolean);
function findInBun(root, pkg, sub) {
  const cands = [path.join(root, "node_modules", pkg)];
  const bunDir = path.join(root, "node_modules", ".bun");
  try {
    if (fs.existsSync(bunDir))
      for (const d of fs.readdirSync(bunDir))
        if (d.startsWith(pkg + "@")) cands.push(path.join(bunDir, d, "node_modules", pkg));
  } catch {}
  for (const c of cands) {
    const p = sub ? path.join(c, sub) : c;
    if (fs.existsSync(p)) return p;
  }
  return null;
}
let puppeteer = null,
  sharp = null,
  gsapSource = null;
for (const r of HF_ROOTS) {
  if (!puppeteer) {
    const p = findInBun(r, "puppeteer");
    if (p)
      try {
        puppeteer = require(p);
      } catch {}
  }
  if (!sharp) {
    const p = findInBun(r, "sharp");
    if (p)
      try {
        sharp = require(p);
      } catch {}
  }
  if (!gsapSource) {
    const g = findInBun(r, "gsap", path.join("dist", "gsap.min.js"));
    if (g) gsapSource = fs.readFileSync(g, "utf8");
  }
}
if (require.main === module && (!puppeteer || !sharp)) {
  console.error("[preview] need puppeteer+sharp — set HYPERFRAMES_ROOT");
  process.exit(0);
}

async function shotAt(browser, file, W, H, t) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    // Serve the page's own CDN <script src=gsap> request from the local bundle
    // (offline-safe) instead of injecting gsap at document-start: a document-start
    // evaluation runs while document.head is still null, and gsap's init then
    // throws "appendChild of null" — which killed previews for theme projects.
    await page.setRequestInterception(true);
    const documentUrl = pathToFileURL(file).href;
    const documentHtml = stripGsapSri(fs.readFileSync(file, "utf8"));
    page.on("request", (req) => {
      const u = req.url();
      if (req.isNavigationRequest() && u === documentUrl) {
        req.respond({ status: 200, contentType: "text/html", body: documentHtml });
      } else if (req.resourceType() === "script" && /gsap/i.test(u) && /^https?:/i.test(u)) {
        if (gsapSource)
          req.respond({ status: 200, contentType: "application/javascript", body: gsapSource });
        else req.continue(); // no local bundle — let the CDN load (online machines)
      } else if (req.resourceType() === "media")
        req.abort(); // a-roll pixels come from frames_bg
      else req.continue();
    });
    await page.goto(documentUrl, { waitUntil: "load", timeout: 15000 });
    const t0 = Date.now();
    let tlReady = false;
    while (Date.now() - t0 < 15000) {
      tlReady = await page.evaluate(() => !!(window.__timelines && window.__timelines.main));
      if (tlReady) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    if (!tlReady) throw new Error(`timeline never registered in ${path.basename(file)}`);
    // bundled @font-face → previews show the REAL faces (same set the renderer embeds)
    try {
      const fontsCss = path.join(__dirname, "..", "modes", "standard", "fonts", "fonts.css");
      if (fs.existsSync(fontsCss))
        await page.addStyleTag({ content: fs.readFileSync(fontsCss, "utf8") });
    } catch {}
    await page.evaluate(async () => {
      try {
        await document.fonts.ready;
      } catch {}
    });
    await page.evaluate((t) => {
      const v = document.getElementById("a-roll");
      if (v) v.style.display = "none"; // transparent hole for the bg frame
      document.body.style.background = "transparent";
      document.documentElement.style.background = "transparent";
      window.__timelines.main.seek(t);
      void document.body.offsetHeight;
    }, t);
    await new Promise((r) => setTimeout(r, 60));
    return await page.screenshot({ omitBackground: true }); // RGBA png of caption layer only
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const project = path.resolve(process.argv[2] || "");
  if (!process.argv[2]) {
    console.error("usage: preview-frames.cjs <project-dir> [times...]");
    process.exit(1);
  }
  const idx = path.join(project, "index.html");
  if (!fs.existsSync(idx)) {
    console.error("[preview] no index.html — compile first");
    process.exit(1);
  }
  const railP = path.join(project, "rail.html");
  const hasRail = fs.existsSync(railP);
  const fgP = path.join(project, "index_fg.html");
  const hasFg = fs.existsSync(fgP); // hybrid: fg caps render ABOVE the matte (like the real composite)

  let fps = 24;
  try {
    const f = parseFloat(
      String(fs.readFileSync(path.join(project, "matte.fps"), "utf8")).replace(/[^\d.]/g, ""),
    );
    if (f > 0) fps = f;
  } catch {}

  // sample times: explicit > climax window + line midpoints > thirds
  let globalFg = false;
  try {
    globalFg =
      JSON.parse(fs.readFileSync(path.join(project, "plan.json"), "utf8")).caption_layer === "fg";
  } catch {}
  let times = process.argv.slice(3).map(Number).filter(Number.isFinite);
  if (!times.length) {
    try {
      const plan = JSON.parse(fs.readFileSync(path.join(project, "plan.json"), "utf8"));
      // heroes get 2 samples each (entrance + hold); every OTHER group gets at least
      // a shot at one midpoint — the old 2-per-group list truncated at 12 and silently
      // dropped whole narration blocks from the sheet (cold-start agents missed bugs there)
      const gs = plan.groups || [];
      const heroes = gs.filter((g) => g.hero === true),
        rest = gs.filter((g) => !g.hero);
      for (const g of heroes) {
        const span = g.out - g.in;
        times.push(+(g.in + span * 0.25).toFixed(2), +(g.in + span * 0.7).toFixed(2));
      }
      const mids = rest.map((g) => +((g.in + g.out) / 2).toFixed(2));
      const budget = Math.max(2, 16 - times.length);
      const step = Math.max(1, Math.ceil(mids.length / budget));
      for (let i = 0; i < mids.length; i += step) times.push(mids[i]);
    } catch {}
  }
  if (!times.length) {
    const n = fs.existsSync(path.join(project, "frames_bg"))
      ? fs.readdirSync(path.join(project, "frames_bg")).length
      : 0;
    const dur = n / fps || 10;
    times = [dur * 0.25, dur * 0.5, dur * 0.75].map((t) => +t.toFixed(2));
  }
  times = [...new Set(times)].slice(0, 16).sort((a, b) => a - b);

  const meta = await sharp(
    path.join(
      project,
      "frames_bg",
      fs
        .readdirSync(path.join(project, "frames_bg"))
        .filter((f) => f.endsWith(".png"))
        .sort()[0],
    ),
  ).metadata();
  const W = meta.width,
    H = meta.height;
  const outDir = path.join(project, "preview");
  fs.mkdirSync(outDir, { recursive: true });

  const exe =
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/usr/bin/google-chrome";
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: fs.existsSync(exe) ? exe : undefined,
    args: ["--disable-web-security", "--allow-file-access-from-files", "--disable-dev-shm-usage"],
  });
  const outs = [];
  try {
    for (const t of times) {
      const fi = Math.max(1, Math.round(t * fps));
      const bg = path.join(project, "frames_bg", `f_${String(fi).padStart(4, "0")}.png`);
      const fg = path.join(project, "frames_fg", `f_${String(fi).padStart(4, "0")}.png`);
      if (!fs.existsSync(bg)) {
        console.error(`[preview] no bg frame for t=${t}`);
        continue;
      }
      const layers = [{ input: await shotAt(browser, idx, W, H, t) }]; // embed captions
      // global caption_layer:"fg" → captions sit ON TOP of the subject; the matte
      // must NOT be stacked over them (the render skips the overlay too).
      if (!globalFg && fs.existsSync(fg)) layers.push({ input: fg }); // subject occludes embed
      if (hasFg) layers.push({ input: await shotAt(browser, fgP, W, H, t), blend: "screen" }); // hybrid fg caps in front (screen, like the real ffmpeg pass)
      if (hasRail) layers.push({ input: await shotAt(browser, railP, W, H, t) }); // rail in front
      const out = path.join(outDir, `t${String(t).replace(".", "_")}.png`);
      await sharp(bg).composite(layers).png().toFile(out);
      outs.push({ t, out });
      console.log(`[preview] t=${t}s → ${out}`);
    }
    // contact sheet
    if (outs.length) {
      const TW = 480,
        TH = Math.round((TW * H) / W);
      const comps = [];
      for (let i = 0; i < outs.length; i++)
        comps.push({
          input: await sharp(outs[i].out).resize(TW, TH).toBuffer(),
          left: (i % 4) * TW,
          top: Math.floor(i / 4) * TH,
        });
      const rows = Math.ceil(outs.length / 4);
      await sharp({
        create: {
          width: 4 * TW,
          height: rows * TH,
          channels: 3,
          background: { r: 16, g: 16, b: 16 },
        },
      })
        .composite(comps)
        .png()
        .toFile(path.join(outDir, "sheet.png"));
      console.log(
        `[preview] contact sheet → ${path.join(outDir, "sheet.png")}  (${outs.length} frames @ ${times.join(", ")}s)`,
      );
    }
  } finally {
    await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  }
}
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[preview]", e.message);
      process.exit(1);
    });
}

module.exports = { stripGsapSri };
