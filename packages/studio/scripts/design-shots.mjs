#!/usr/bin/env node
/**
 * Design review capture: boots Studio from source on a free port, walks it
 * through six review states, screenshots each one, and prints a computed-style
 * table for a fixed selector list.
 *
 * The table is the point. Screenshots show that two controls look different;
 * only the measured height / radius / font-size / background says by how much,
 * and that is what a before/after pair of runs compares.
 *
 *   bun run --cwd packages/studio design:shots
 *   bun run --cwd packages/studio design:shots -- --out /tmp/before
 *   bun run --cwd packages/studio design:shots -- --storybook-url http://localhost:6006
 *
 * Server discipline: the run starts its own Vite dev server on a port nobody is
 * listening on, and kills that one pid on exit. It never touches a server it
 * did not start, so it is safe to run while another Studio session is up.
 */
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STUDIO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The controls the sweep is judged on. Every entry is measured wherever it is
 * first visible across the six states, so a control that only exists inside a
 * menu still gets a row.
 *
 * Selectors prefer an attribute the component owns (aria-label, role,
 * data-testid) over a class, because a reskin rewrites
 * every class in this package and a table that stops resolving is a table that
 * silently reports "not found" instead of a regression.
 */
export const DESIGN_SHOT_SELECTORS = [
  { key: "header-export", label: "Header Export", selector: '[data-testid="header-export"]' },
  { key: "renders-export", label: "Renders Export", selector: '[data-testid="renders-export"]' },
  {
    key: "inspector-input",
    label: "Inspector metric input",
    selector: '[data-testid="inspector-field"]',
  },
  {
    key: "timeline-toolbar-button",
    label: "Timeline toolbar button",
    selector: '[aria-label="Selection tool"]',
  },
  { key: "menu-item", label: "Menu item", selector: '[role="menuitemradio"]' },
];

const TABLE_COLUMNS = ["Control", "Selector", "Height", "Radius", "Font size", "Background"];

/**
 * One row per selector, in declaration order, whether or not it resolved. A
 * dropped row would read as "the control is unchanged"; `not found` reads as
 * what it is.
 */
export function formatTable(measurements) {
  const cell = (value) => String(value ?? "not found").replaceAll("|", "\\|");
  const rows = DESIGN_SHOT_SELECTORS.map((entry) => {
    const m = measurements[entry.key] ?? {};
    return [
      entry.label,
      `\`${entry.selector}\``,
      cell(m.height),
      cell(m.radius),
      cell(m.fontSize),
      cell(m.background),
    ];
  });
  return [
    `| ${TABLE_COLUMNS.join(" | ")} |`,
    `| ${TABLE_COLUMNS.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: join(STUDIO_DIR, ".design-shots"), storybookUrl: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = resolve(argv[++i]);
    else if (argv[i] === "--storybook-url") args.storybookUrl = argv[++i];
  }
  return args;
}

/** Ask the OS for a port nobody holds, then hand it to Vite with --strictPort. */
function freePort() {
  return new Promise((res, rej) => {
    const server = createServer();
    server.on("error", rej);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => res(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return false;
}

/**
 * Studio resolves projects out of data/projects, which is gitignored. The
 * fixture is tracked under tests/e2e, so copy it into place per run under a
 * name that belongs to this script and cannot collide with a real project.
 */
function installFixture() {
  const projectId = "design-shots";
  const target = join(STUDIO_DIR, "data", "projects", projectId);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(STUDIO_DIR, "tests", "e2e", "fixtures", "design-panel-qa"), target, {
    recursive: true,
  });
  return projectId;
}

function startStudio(port) {
  const child = spawn(
    "bun",
    ["run", "dev", "--", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    { cwd: STUDIO_DIR, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, readLog: () => log };
}

async function measureAll(page, into) {
  const measured = await page.evaluate((entries) => {
    const out = {};
    for (const entry of entries) {
      const el = document.querySelector(entry.selector);
      if (!el) continue;
      const style = getComputedStyle(el);
      out[entry.key] = {
        height: `${Math.round(el.getBoundingClientRect().height)}px`,
        radius: style.borderRadius,
        fontSize: style.fontSize,
        background: style.backgroundColor,
      };
    }
    return out;
  }, DESIGN_SHOT_SELECTORS);
  // First sighting wins: a control measured in the state built to show it is
  // more trustworthy than the same selector matching something else later.
  for (const [key, value] of Object.entries(measured)) into[key] ??= value;
}

async function shoot(page, outDir, name) {
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`captured ${name}.png`);
}

/**
 * Boot Studio from source and open a browser on it. Shared with
 * scripts/menu-dismiss-spike.mjs so both runs prove things against the same
 * app, the same fixture and the same Chrome. Call `shutdown()` when done: it
 * kills only the pid this call started.
 */
export async function bootStudio() {
  const { default: puppeteer } = await import("puppeteer-core");
  const { resolveChromeExecutable } = await import("../tests/e2e/chrome-executable.mjs");
  const executablePath = resolveChromeExecutable();
  if (!executablePath) throw new Error("no Chrome found; set PUPPETEER_EXECUTABLE_PATH");

  const projectId = installFixture();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const { child, readLog } = startStudio(port);

  let browser = null;
  const shutdown = async () => {
    if (browser) {
      const closing = browser;
      browser = null;
      await closing.close().catch(() => {});
    }
    // Exact pid only. Another Studio dev server may be running for a human.
    if (child.pid) {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  };
  process.on("exit", () => {
    void shutdown();
  });

  try {
    if (!(await waitForServer(baseUrl))) {
      throw new Error(`studio dev server did not start on ${port}\n${readLog()}`);
    }
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--window-size=1600,1000"],
      defaultViewport: { width: 1600, height: 1000 },
    });
    const page = await browser.newPage();
    return { page, baseUrl, projectId, shutdown };
  } catch (error) {
    await shutdown();
    throw error;
  }
}

export async function gotoState(page, baseUrl, projectId, params) {
  const query = new URLSearchParams({ v: "1", ...params }).toString();
  // Not networkidle: the dev server holds an HMR socket open and the fixture
  // pulls GSAP from a CDN, so "the network went quiet" never reliably fires.
  // The app's own header is the readiness signal.
  await page.goto(`${baseUrl}/#project/${projectId}?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="header-export"]', { timeout: 30_000 });
}

export async function selectFixtureElement(page) {
  await page.waitForFunction(() => typeof window.__studioTest?.selectByDomId === "function", {
    timeout: 30_000,
  });
  // The preview iframe has to have painted before selectByDomId can resolve the
  // node; polling the hook's own return value is the only honest ready signal.
  await page.waitForFunction(
    async () => (await window.__studioTest.selectByDomId("qa-headline")) === true,
    { timeout: 30_000, polling: 500 },
  );
}

async function capture(page, baseUrl, projectId, outDir, measurements) {
  // 1. Fresh boot, header visible.
  await gotoState(page, baseUrl, projectId, { tv: "1" });
  await measureAll(page, measurements);
  await shoot(page, outDir, "1-fresh-boot");

  // 2. Element selected, inspector on its Design tab.
  await selectFixtureElement(page);
  await page.waitForSelector('[data-testid="inspector-field"]', { timeout: 30_000 });
  await measureAll(page, measurements);
  await shoot(page, outDir, "2-inspector-design");

  // 3. Renders tab. The Export control is the panel header, not a per-job
  //    action, so it renders with an empty queue and needs no render to exist.
  await gotoState(page, baseUrl, projectId, { tab: "renders", rc: "0", tv: "1" });
  await page.waitForSelector('[data-testid="renders-export"]', { timeout: 30_000 });
  await measureAll(page, measurements);
  await shoot(page, outDir, "3-renders-panel");

  // 4. Context menu over the canvas. The overlay opens it from a real
  //    contextmenu event, and only once a selection is settled.
  await gotoState(page, baseUrl, projectId, { tv: "1" });
  await selectFixtureElement(page);
  const overlay = await page.$('[aria-label="Composition canvas"]');
  const box = await overlay.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await page.waitForSelector("body > div.fixed", { timeout: 10_000 }).catch(() => {});
  await measureAll(page, measurements);
  await shoot(page, outDir, "4-canvas-context-menu");
  await page.keyboard.press("Escape");

  // 5. Timeline toolbar.
  await page.waitForSelector('[aria-label="Selection tool"]', { timeout: 30_000 });
  await measureAll(page, measurements);
  await shoot(page, outDir, "5-timeline-toolbar");

  // 6. Speed menu, the reachable timeline popover.
  await page.click('[aria-label="Playback speed"]');
  await page.waitForSelector('[role="menuitemradio"]', { timeout: 10_000 });
  await measureAll(page, measurements);
  await shoot(page, outDir, "6-timeline-speed-menu");
}

async function captureStorybook(page, storybookUrl, outDir) {
  if (!storybookUrl) {
    console.log("7-storybook-index.png skipped: no storybook url");
    return;
  }
  await page.goto(storybookUrl, { waitUntil: "domcontentloaded" });
  await shoot(page, outDir, "7-storybook-index");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });

  const { page, baseUrl, projectId, shutdown } = await bootStudio();
  try {
    const measurements = {};
    await capture(page, baseUrl, projectId, args.out, measurements);
    await captureStorybook(page, args.storybookUrl, args.out);

    const table = formatTable(measurements);
    writeFileSync(join(args.out, "table.md"), `${table}\n`);
    console.log(`\n${table}\n`);
    console.log(`wrote ${args.out}`);
  } finally {
    await shutdown();
  }
}

if (process.argv[1] && process.argv[1].endsWith("design-shots.mjs")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
