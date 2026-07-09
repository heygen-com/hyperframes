#!/usr/bin/env node
/**
 * measure-layout.cjs - pixel-perfect bbox measurement using headless Chromium.
 *
 * Loads the compiled index.html, seeks the registered timeline to specified sample
 * times, queries every .cap container + every .w word span via
 * getBoundingClientRect(), writes results to _layout.json.
 *
 * check-occlusion.cjs then reads _layout.json + frames_fg/*.png and computes
 * per-word occlusion against the actual subject silhouette (matte alpha via
 * sharp) - pixel accurate, no char_ratio guessing.
 *
 * Usage:
 *   node measure-layout.cjs <project-dir> [times...]
 * If no times given, samples groups['in', 'out'] midpoints.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");

// Locate hyperframes' bundled puppeteer. render-and-composite.sh exports
// HYPERFRAMES_ROOT; standalone we also try the in-repo path + ~/Downloads, and
// accept ANY puppeteer@* the bun store holds (not a pinned version).
const HF_ROOTS = [
  process.env.HYPERFRAMES_ROOT,
  path.resolve(__dirname, "../../.."), // skills/embedded-captions/scripts → repo root if in-repo
  path.join(os.homedir(), "Downloads", "hyperframes"),
].filter(Boolean);
let puppeteer = null;
for (const root of HF_ROOTS) {
  const cands = [path.join(root, "node_modules", "puppeteer")];
  const bunDir = path.join(root, "node_modules", ".bun");
  try {
    if (fs.existsSync(bunDir)) {
      for (const d of fs.readdirSync(bunDir)) {
        if (d.startsWith("puppeteer@"))
          cands.push(path.join(bunDir, d, "node_modules", "puppeteer"));
      }
    }
  } catch {
    /* ignore */
  }
  for (const p of cands) {
    try {
      if (fs.existsSync(p)) {
        puppeteer = require(p);
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (puppeteer) break;
}
if (!puppeteer) {
  console.error(
    "[measure] could not locate puppeteer - set HYPERFRAMES_ROOT to a built hyperframes checkout",
  );
  process.exit(3);
}

// Optional compatibility for GSAP as the supported non-default adapter. Older
// templates load GSAP from a CDN (cdn.jsdelivr.net), but in headless Chromium
// that request can be slow or blocked. We inject this local copy when present.
let gsapSource = null;
for (const root of HF_ROOTS) {
  const cands = [path.join(root, "node_modules", "gsap", "dist", "gsap.min.js")];
  const bunDir = path.join(root, "node_modules", ".bun");
  try {
    if (fs.existsSync(bunDir)) {
      for (const d of fs.readdirSync(bunDir)) {
        if (d.startsWith("gsap@"))
          cands.push(path.join(bunDir, d, "node_modules", "gsap", "dist", "gsap.min.js"));
      }
    }
  } catch {
    /* ignore */
  }
  for (const p of cands) {
    try {
      if (fs.existsSync(p)) {
        gsapSource = fs.readFileSync(p, "utf8");
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (gsapSource) break;
}

async function main() {
  const projectDir = process.argv[2];
  if (!projectDir) {
    console.error("usage: measure-layout.cjs <project-dir> [t1 t2 ...]");
    process.exit(1);
  }
  const indexPath = path.resolve(projectDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    console.error(`[measure] missing ${indexPath} - run make-composition.cjs first`);
    process.exit(2);
  }

  // Load plan to get groups + sample times
  const planPath = path.join(projectDir, "plan.json");
  let plan = null;
  if (fs.existsSync(planPath)) plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

  // Determine sample times: per group, sample multiple points across [in, out]
  // (catches subject motion within block, multi-frame validation).
  const explicitTimes = process.argv.slice(3).map(Number).filter(Number.isFinite);
  let sampleTimes = explicitTimes;
  if (sampleTimes.length === 0 && plan?.groups) {
    const allTimes = new Set();
    for (const g of plan.groups) {
      const dur = g.out - g.in;
      // 4 samples per group: 15%, 40%, 65%, 90% through window - covers entry/peak/exit
      [0.15, 0.4, 0.65, 0.9].forEach((p) => allTimes.add(+(g.in + dur * p).toFixed(3)));
    }
    sampleTimes = [...allTimes].sort((a, b) => a - b);
  }

  // Match render-and-composite's Chrome detection
  const exe =
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/usr/bin/google-chrome";

  const W = plan?.width || 720;
  const H = plan?.height || 1290;
  const FPS = plan?.fps || 24;

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: fs.existsSync(exe) ? exe : undefined,
    args: [
      "--disable-web-security",
      "--allow-file-access-from-files",
      `--window-size=${W},${H}`,
      "--disable-dev-shm-usage",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    page.on("pageerror", (err) => console.error(`[browser-error] ${err.message}`));

    await page.evaluateOnNewDocument(() => {
      const registry = {};
      window.__hfAnime = registry;
      window.hyperframesAnime = {
        register(id, instance, options) {
          const entry = { id, instance, labels: (options && options.labels) || {} };
          registry[id] = entry;
          return entry;
        },
        get(id) {
          return registry[id] || null;
        },
        entries() {
          return Object.values(registry);
        },
      };
    });

    // Inject local GSAP before any page script + abort the CDN <script> for
    // non-default GSAP templates. Falls back to the page's own CDN load if no
    // local copy was found.
    if (gsapSource) {
      await page.evaluateOnNewDocument(gsapSource);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const u = req.url();
        if (req.resourceType() === "script" && /gsap/i.test(u) && /^https?:/i.test(u)) req.abort();
        else req.continue();
      });
    }

    await page.goto(`file://${indexPath}`, { waitUntil: "load", timeout: 15000 });
    // Poll for either anime.js first-party registration or non-default GSAP registration.
    const start = Date.now();
    let ready = false;
    while (Date.now() - start < 15000) {
      const r = await page.evaluate(() => {
        const animeEntry = window.hyperframesAnime && window.hyperframesAnime.get("main");
        return (
          !!(animeEntry && animeEntry.instance) || !!(window.__timelines && window.__timelines.main)
        );
      });
      if (r) {
        ready = true;
        break;
      }
      await new Promise((res) => setTimeout(res, 200));
    }
    if (!ready) {
      console.error("[measure] timeline never registered");
      process.exit(4);
    }
    // Inject the skill's bundled @font-face set so headless Chromium measures the SAME
    // glyph metrics the renderer will use. Without this, Inter/etc fall back to system
    // fonts here while the real render uses the true (often wider) face → wrapped line
    // counts differ → slot layout / occlusion verdicts are measured on the wrong text.
    try {
      const fontsCss = path.join(__dirname, "..", "modes", "standard", "fonts", "fonts.css");
      if (fs.existsSync(fontsCss))
        await page.addStyleTag({ content: fs.readFileSync(fontsCss, "utf8") });
    } catch {
      /* best-effort - fonts.css missing just reverts to old behavior */
    }
    // let webfonts settle so measured glyph metrics match the render
    await page.evaluate(async () => {
      try {
        await document.fonts.ready;
      } catch {}
    });

    const samples = [];
    for (const t of sampleTimes) {
      // Seek timeline
      await page.evaluate((t) => {
        const animeEntry = window.hyperframesAnime && window.hyperframesAnime.get("main");
        if (animeEntry && animeEntry.instance && typeof animeEntry.instance.seek === "function") {
          animeEntry.instance.seek(t * 1000);
        } else {
          window.__timelines.main.seek(t);
        }
        // Force layout flush
        void document.body.offsetHeight;
      }, t);
      // Tiny settle for animations / fonts
      await new Promise((r) => setTimeout(r, 30));

      // Measure every .cap and its .w children
      const measurements = await page.evaluate(() => {
        const caps = [...document.querySelectorAll(".cap")];
        const out = [];
        for (const cap of caps) {
          const cs = getComputedStyle(cap);
          if (cs.opacity === "0" || cs.display === "none") continue;
          const cb = cap.getBoundingClientRect();
          if (cb.width === 0 || cb.height === 0) continue;
          const id = cap.id || "";
          const layer = cap.dataset.layer || "";
          // Per-line via Range over all word spans
          const ws = [...cap.querySelectorAll(".w")];
          const words = [];
          for (const w of ws) {
            const wcs = getComputedStyle(w);
            if (wcs.opacity === "0") continue; // not yet animated in
            const wb = w.getBoundingClientRect();
            if (wb.width === 0) continue;
            words.push({
              text: w.textContent,
              x: +wb.x.toFixed(1),
              y: +wb.y.toFixed(1),
              w: +wb.width.toFixed(1),
              h: +wb.height.toFixed(1),
              opacity: +wcs.opacity,
            });
          }
          // Group by line (same y ± 2px)
          const lines = [];
          for (const w of words) {
            const line = lines.find((l) => Math.abs(l.y - w.y) < 3);
            if (line) {
              line.words.push(w);
              line.x = Math.min(line.x, w.x);
              line.w = Math.max(line.x + line.w, w.x + w.w) - line.x;
              line.h = Math.max(line.h, w.h);
            } else {
              lines.push({ x: w.x, y: w.y, w: w.w, h: w.h, words: [w] });
            }
          }
          out.push({
            id,
            layer,
            cap_bbox: {
              x: +cb.x.toFixed(1),
              y: +cb.y.toFixed(1),
              w: +cb.width.toFixed(1),
              h: +cb.height.toFixed(1),
            },
            opacity: +cs.opacity,
            lines,
            words, // also keep flat list
          });
        }
        return out;
      });
      const frame_idx = Math.max(1, Math.round(t * FPS));
      samples.push({ t, frame_idx, caps: measurements });
    }

    const layout = { width: W, height: H, fps: FPS, samples };
    const outPath = path.join(projectDir, "_layout.json");
    fs.writeFileSync(outPath, JSON.stringify(layout, null, 2));
    console.log(
      `[measure] wrote ${outPath} (${sampleTimes.length} sample frames, ${samples.reduce((a, s) => a + s.caps.length, 0)} cap measurements)`,
    );
  } finally {
    // Chromium occasionally hangs on shutdown. This script runs synchronously
    // inside check-occlusion.cjs, which the render gate blocks on - a hung close
    // would wedge the whole render. Cap the close, then force-exit below.
    await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  }
}

// Force a hard exit so a lingering Chromium/libuv handle can't keep the process
// (and the render gate that spawned it) alive indefinitely.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
