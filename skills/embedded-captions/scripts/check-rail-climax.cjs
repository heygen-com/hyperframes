#!/usr/bin/env node
/*
 * check-rail-climax.cjs - enforce the Rail ↔ climax hand-off (PIPELINE.md).
 *
 *   node check-rail-climax.cjs <project-dir>
 *
 * The embed climax is a PROMOTED word - lifted out of the rail into the hero
 * layer. It must NEVER also be revealed in the rail. This gate loads index.html
 * (the climax) and rail.html (the verbatim rail) in headless Chromium, finds the
 * climax's on-screen window + its word(s), then checks whether the rail reveals
 * any of those same words DURING that window. If it does, the promoted word is
 * duplicated on screen → exit 2 (the render aborts). Standard mode only.
 *
 * Conservative by design: only a CONFIRMED duplicate fails. Anything we can't
 * determine (no rail.html, no puppeteer, timeline never registers, no climax)
 * exits 0 - infra problems never block a render.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");

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
  } catch {
    /* ignore */
  }
  for (const c of cands) {
    const p = sub ? path.join(c, sub) : c;
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let puppeteer = null,
  gsapSource = null;
for (const root of HF_ROOTS) {
  if (!puppeteer) {
    const p = findInBun(root, "puppeteer");
    if (p) {
      try {
        puppeteer = require(p);
      } catch {}
    }
  }
  if (!gsapSource) {
    const g = findInBun(root, "gsap", path.join("dist", "gsap.min.js"));
    if (g) gsapSource = fs.readFileSync(g, "utf8");
  }
}

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const toks = (s) =>
  String(s)
    .split(/\s+/)
    .map(norm)
    .filter((t) => t.length >= 2);

function ok(msg) {
  if (msg) console.log(msg);
  process.exit(0);
} // can't-determine / pass → never blocks
function fail(msg) {
  console.error(msg);
  process.exit(2);
}

async function newPage(browser, W, H) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
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
  if (gsapSource) {
    await page.evaluateOnNewDocument(gsapSource);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      if (req.resourceType() === "script" && /gsap/i.test(u) && /^https?:/i.test(u)) req.abort();
      else req.continue();
    });
  }
  return page;
}
async function load(page, file) {
  await page.goto(`file://${file}`, { waitUntil: "load", timeout: 15000 });
  const start = Date.now();
  while (Date.now() - start < 12000) {
    if (
      await page.evaluate(() => {
        const animeEntry = window.hyperframesAnime && window.hyperframesAnime.get("main");
        return !!(animeEntry && animeEntry.instance) || !!(window.__timelines && window.__timelines.main);
      })
    ) {
      try {
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
      } catch {}
      return true;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
// visible text of a selector at time t, by seeking the page's main timeline.
// Visibility must be EFFECTIVE (own opacity × every ancestor's): a rail line that
// fades out as a CONTAINER leaves its word spans at opacity:1 - checking only the
// span's own style false-positives on text that is actually invisible.
async function visibleAt(page, t, selector, childSel) {
  return page.evaluate(
    (t, selector, childSel) => {
      const animeEntry = window.hyperframesAnime && window.hyperframesAnime.get("main");
      if (animeEntry && animeEntry.instance && typeof animeEntry.instance.seek === "function") {
        animeEntry.instance.seek(t * 1000);
      } else {
        window.__timelines.main.seek(t);
      }
      void document.body.offsetHeight;
      const eff = (el) => {
        let o = 1,
          n = el;
        while (n && n.nodeType === 1) {
          const cs = getComputedStyle(n);
          if (cs.display === "none" || cs.visibility === "hidden") return 0;
          o *= +cs.opacity;
          n = n.parentElement;
        }
        return o;
      };
      const out = [];
      for (const el of document.querySelectorAll(selector)) {
        if (eff(el) < 0.05) continue;
        const kids = childSel ? [...el.querySelectorAll(childSel)] : [];
        if (kids.length) {
          for (const k of kids) {
            if (eff(k) > 0.05) out.push(k.textContent);
          }
        } else if ((el.textContent || "").trim()) out.push(el.textContent);
      }
      return out.join(" ").trim();
    },
    t,
    selector,
    childSel,
  );
}

async function main() {
  const project = path.resolve(process.argv[2] || "");
  if (!process.argv[2]) ok("[rail-climax] usage: check-rail-climax.cjs <project-dir>");
  const indexPath = path.join(project, "index.html");
  const railPath = path.join(project, "rail.html");
  if (!fs.existsSync(railPath) || !fs.existsSync(indexPath))
    ok("[rail-climax] no rail.html+index.html - not Standard, skipping");
  if (!puppeteer) ok("[rail-climax] puppeteer unavailable - skipping (set HYPERFRAMES_ROOT)");

  const exe =
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/usr/bin/google-chrome";
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: fs.existsSync(exe) ? exe : undefined,
      args: ["--disable-web-security", "--allow-file-access-from-files", "--disable-dev-shm-usage"],
    });
  } catch (e) {
    ok(`[rail-climax] could not launch Chromium - skipping (${e.message})`);
  }

  try {
    // index.html → climax window + climax word tokens
    const ip = await newPage(browser, 1920, 1080);
    if (!(await load(ip, indexPath)))
      ok("[rail-climax] index timeline never registered - skipping");
    const dur =
      +(await ip.evaluate(() => {
        const r = document.querySelector("#root") || document.querySelector("[data-duration]");
        return (r && r.dataset && r.dataset.duration) || 0;
      })) || 30;
    const STEP = 0.1;
    const climaxTokens = new Set();
    let winIn = null,
      winOut = null;
    for (let t = 0; t <= dur + 0.001; t += STEP) {
      const txt = await visibleAt(ip, +t.toFixed(2), ".climax", "span,.w");
      if (txt) {
        toks(txt).forEach((w) => climaxTokens.add(w));
        if (winIn === null) winIn = t;
        winOut = t;
      }
    }
    if (!climaxTokens.size || winIn === null)
      ok("[rail-climax] no visible climax found in index.html - skipping");

    // rail.html → words visible during [winIn, winOut]
    const rp = await newPage(browser, 1920, 1080);
    if (!(await load(rp, railPath))) ok("[rail-climax] rail timeline never registered - skipping");
    const hits = new Map(); // token -> first t seen
    for (let t = Math.max(0, winIn - STEP); t <= winOut + 0.001; t += STEP) {
      const railToks = new Set(toks(await visibleAt(rp, +t.toFixed(2), ".w", null)));
      for (const w of climaxTokens) if (railToks.has(w) && !hits.has(w)) hits.set(w, +t.toFixed(2));
    }

    if (hits.size) {
      const list = [...hits.entries()]
        .map(([w, t]) => `"${w}" (rail shows it at t=${t}s)`)
        .join(", ");
      fail(
        `[rail-climax] ✗ DUPLICATE PROMOTED WORD: the climax word(s) ${[...climaxTokens].map((w) => `"${w}"`).join(", ")} ` +
          `are on screen during the climax window [${winIn.toFixed(2)}–${winOut.toFixed(2)}s], ` +
          `and the rail ALSO reveals: ${list}.\n` +
          `  The promoted word must be handed off, never duplicated - see PIPELINE.md "Rail ↔ climax hand-off":\n` +
          `  freeze the rail before the promoted word, let the climax carry it, hold the climax across the rail's\n` +
          `  page-flip, and exit it at the end of the thought. The rail must never reveal the promoted word.`,
      );
    }
    console.log(
      `[rail-climax] ✓ ok - promoted word(s) ${[...climaxTokens].map((w) => `"${w}"`).join(", ")} not duplicated in the rail (window ${winIn.toFixed(2)}–${winOut.toFixed(2)}s)`,
    );
  } finally {
    await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`[rail-climax] (skipped - ${e.message})`);
    process.exit(0);
  });
