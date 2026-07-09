#!/usr/bin/env node
/**
 * check-overflow.cjs - mode-agnostic frame-overflow WARNING for custom mode.
 *
 * Template mode has check-occlusion.cjs (which also flags frame-edge overflow),
 * but custom mode runs no gates. This is the cheap safety net: it loads the
 * rendered index.html, seeks the registered timeline across the clip, and flags ANY
 * visible text element (regardless of class) whose box leaves the canvas, i.e.
 * captions that fall off-frame (the bug we otherwise only catch by eye).
 *
 * WARNING ONLY - never fails the build (custom designs may bleed intentionally).
 * Exit 0 if it ran (with or without findings); exit 3 if it couldn't run.
 *
 * Usage: node check-overflow.cjs <project-dir>
 */
const path = require("path");
const fs = require("fs");
const os = require("os");

const HF_ROOTS = [
  process.env.HYPERFRAMES_ROOT,
  path.resolve(__dirname, "../../.."),
  path.join(os.homedir(), "Downloads", "hyperframes"),
].filter(Boolean);
let puppeteer = null;
for (const root of HF_ROOTS) {
  const cands = [path.join(root, "node_modules", "puppeteer")];
  const bunDir = path.join(root, "node_modules", ".bun");
  try {
    if (fs.existsSync(bunDir)) {
      for (const d of fs.readdirSync(bunDir))
        if (d.startsWith("puppeteer@"))
          cands.push(path.join(bunDir, d, "node_modules", "puppeteer"));
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
    } catch {}
  }
  if (puppeteer) break;
}
if (!puppeteer) {
  console.error("[overflow] puppeteer not found");
  process.exit(3);
}

async function main() {
  const projectDir = process.argv[2];
  const htmlName = process.argv[3] || "index.html"; // Standard mode passes "rail.html" to gate the rail too
  const indexPath = path.resolve(projectDir, htmlName);
  if (!fs.existsSync(indexPath)) {
    console.error(`[overflow] missing ${indexPath}`);
    process.exit(2);
  }

  const html = fs.readFileSync(indexPath, "utf8");
  const num = (re, d) => {
    const m = html.match(re);
    return m ? parseFloat(m[1]) : d;
  };
  const W = num(/data-width="([0-9.]+)"/, 1920);
  const H = num(/data-height="([0-9.]+)"/, 1080);
  const DUR = num(/data-duration="([0-9.]+)"/, 8);

  const exe =
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/usr/bin/google-chrome";
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
    await page.setViewport({ width: Math.round(W), height: Math.round(H), deviceScaleFactor: 1 });
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
    const waitTL = async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        if (
          await page.evaluate(() => {
            const animeEntry = window.hyperframesAnime && window.hyperframesAnime.get("main");
            return (
              !!(animeEntry && animeEntry.instance) ||
              !!(window.__timelines && window.__timelines.main)
            );
          })
        )
          return true;
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    };
    await page.goto(`file://${indexPath}`, { waitUntil: "load", timeout: 20000 });
    let hasTL = await waitTL();
    if (!hasTL) {
      // CDN script loads can blip and leave no timeline; retry once.
      await page.reload({ waitUntil: "load", timeout: 20000 }).catch(() => {});
      hasTL = await waitTL();
    }
    if (!hasTL) {
      // NEVER claim "ok" when we couldn't actually evaluate the animated layout.
      console.error(
        "[overflow] timeline did not register, overflow check " +
          "INCONCLUSIVE; eyeball the render for off-frame captions.",
      );
      await browser.close();
      process.exit(0);
    }
    await page.evaluate(async () => {
      try {
        await document.fonts.ready;
      } catch {}
    });

    const times = Array.from({ length: 9 }, (_, i) => +((DUR * i) / 8).toFixed(2));
    const found = new Map(); // key text → worst offense

    for (const t of times) {
      await page.evaluate((t) => {
        const animeEntry = window.hyperframesAnime && window.hyperframesAnime.get("main");
        if (animeEntry && animeEntry.instance && typeof animeEntry.instance.seek === "function") {
          animeEntry.instance.seek(t * 1000);
        } else {
          window.__timelines.main.seek(t);
        }
        void document.body.offsetHeight;
      }, t);
      await new Promise((r) => setTimeout(r, 25));
      const offenders = await page.evaluate(
        (W, H) => {
          const M = 2; // tolerance px
          const root = document.querySelector("#stage") || document.body;
          const out = [];
          for (const el of root.querySelectorAll("*")) {
            if (el.tagName === "VIDEO" || el.tagName === "AUDIO") continue;
            const own = [...el.childNodes]
              .filter((n) => n.nodeType === 3)
              .map((n) => n.textContent.trim())
              .join(" ")
              .trim();
            if (!own) continue;
            const cs = getComputedStyle(el);
            if (
              cs.display === "none" ||
              cs.visibility === "hidden" ||
              parseFloat(cs.opacity) < 0.06
            )
              continue;
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            const off = {
              left: Math.max(0, Math.round(-b.left - M)),
              right: Math.max(0, Math.round(b.right - W - M)),
              top: Math.max(0, Math.round(-b.top - M)),
              bottom: Math.max(0, Math.round(b.bottom - H - M)),
            };
            if (off.left || off.right || off.top || off.bottom)
              out.push({ text: own.slice(0, 42), off });
          }
          return out;
        },
        W,
        H,
      );
      for (const o of offenders) {
        const sides = Object.entries(o.off)
          .filter(([, v]) => v > 0)
          .map(([s, v]) => `${s} ${v}px`)
          .join(", ");
        const prev = found.get(o.text);
        const score = Object.values(o.off).reduce((a, b) => a + b, 0);
        if (!prev || score > prev.score) found.set(o.text, { sides, score, t });
      }
    }

    if (found.size === 0) {
      console.log(`[overflow] ok - no caption text leaves the ${W}x${H} frame`);
    } else {
      console.error(
        `[overflow] ⚠ ${found.size} caption(s) leave the frame (custom mode - WARNING only, not blocking):`,
      );
      for (const [text, info] of found)
        console.error(`           "${text}"  → off-frame: ${info.sides}  (@${info.t}s)`);
      console.error(
        `[overflow] if unintentional, reposition/resize; if it's deliberate bleed, ignore.`,
      );
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error("[overflow]", e.message);
  process.exit(3);
});
