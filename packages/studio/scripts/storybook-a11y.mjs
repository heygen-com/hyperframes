#!/usr/bin/env node
/**
 * Runs axe over every story in the gallery and holds the result to a baseline.
 *
 * The a11y addon shows its findings in a panel, which is a person looking at a
 * screen. This is the same engine (axe-core, the copy the addon already
 * depends on) driven headlessly, so "the primitives are a11y clean" becomes a
 * claim something can check rather than one somebody made once.
 *
 *   bun run --cwd packages/studio test:storybook-a11y
 *   bun run --cwd packages/studio test:storybook-a11y -- --update-baseline
 *
 * Why a baseline and not a plain pass/fail: every finding left in
 * `a11y-baseline.json` today is the same thing, Studio's dim-hint palette read
 * at 10 and 11 px. `--color-text-4` on a menu surface is 2.3:1 and
 * `--color-text-3` on a panel is 3.8:1, where AA asks 4.5:1 below 18.66 px.
 * Raising those tokens flattens a deliberate text hierarchy across every panel
 * in the app, which is a palette decision and not this file's to take. So the
 * numbers are written down instead of hidden: a new violation fails, and a
 * fixed one fails too, with instructions to lower the baseline. Same shape as
 * the hex ratchet, for the same reason.
 *
 * Server discipline, as in `design-shots.mjs`: it starts its own Storybook on a
 * port nobody is listening on and kills that one pid on exit. It never touches
 * a server it did not start.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const STUDIO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(STUDIO_DIR, "src/components/ui/a11y-baseline.json");

/** The tags the a11y addon runs by default: WCAG 2.0 and 2.1, levels A and AA. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Ask the OS for a port nobody holds, then hand it to Storybook. */
function freePort() {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForIndex(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`storybook did not answer ${url} in ${timeoutMs}ms`);
}

/** axe-core arrives with the a11y addon; this reads that same copy. */
function axeSource() {
  const require = createRequire(import.meta.url);
  const addon = require.resolve("@storybook/addon-a11y/package.json", { paths: [STUDIO_DIR] });
  return readFileSync(createRequire(addon).resolve("axe-core/axe.min.js"), "utf8");
}

/** `"story rule" -> node count`, in a stable order so a diff reads cleanly. */
function asBaseline(counts) {
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

/** A count above its baseline is a new violation. */
function regressions(counts, baseline) {
  return [...counts]
    .filter(([key, count]) => count > (baseline[key] ?? 0))
    .map(([key, count]) => `new: ${key} (${count}, baseline ${baseline[key] ?? 0})`);
}

/**
 * A count below its baseline is a fix nobody recorded, and leaving it
 * unrecorded is how a ratchet stops ratcheting.
 */
function unrecordedFixes(counts, baseline) {
  return Object.entries(baseline)
    .filter(([key, allowed]) => (counts.get(key) ?? 0) < allowed)
    .map(
      ([key, allowed]) =>
        `fixed, lower the baseline: ${key} (${counts.get(key) ?? 0} < ${allowed})`,
    );
}

/** Every WCAG A/AA violation in the gallery, as `"story rule" -> node count`. */
async function scan(page, baseUrl, stories) {
  const axe = axeSource();
  const counts = new Map();
  const detail = [];
  for (const story of stories) {
    await page.goto(`${baseUrl}/iframe.html?viewMode=story&id=${story.id}`, {
      waitUntil: "networkidle0",
    });
    await page.evaluate(axe);
    const violations = await page.evaluate(async (tags) => {
      const run = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
      return run.violations.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));
    }, TAGS);
    for (const violation of violations) {
      counts.set(`${story.id} ${violation.id}`, violation.nodes);
      detail.push(`${story.id}: ${violation.id} (${violation.nodes}) — ${violation.help}`);
    }
  }
  return { counts, detail };
}

/** Prints the verdict and returns the process exit code. */
function judge(counts, update) {
  if (update) {
    writeFileSync(BASELINE, `${JSON.stringify(asBaseline(counts), null, 2)}\n`);
    console.log(`wrote ${BASELINE}`);
    return 0;
  }
  if (!existsSync(BASELINE)) {
    // A missing baseline is never regenerated as a side effect of a normal run:
    // that would turn every new violation into a silent pass.
    throw new Error(`no baseline at ${BASELINE}; run with --update-baseline and review the diff`);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const failures = [...regressions(counts, baseline), ...unrecordedFixes(counts, baseline)];
  if (failures.length === 0) {
    console.log("no accessibility violations outside the recorded baseline");
    return 0;
  }
  console.error(`\n${failures.join("\n")}`);
  return 1;
}

async function main() {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const storybook = spawn(
    "bunx",
    ["storybook", "dev", "--port", String(port), "--no-open", "--quiet"],
    { cwd: STUDIO_DIR, stdio: "inherit" },
  );

  const { resolveChromeExecutable } = await import("../tests/e2e/chrome-executable.mjs");
  const executablePath = resolveChromeExecutable();
  if (!executablePath) throw new Error("no Chrome found; set PUPPETEER_EXECUTABLE_PATH");

  let browser;
  try {
    const index = await waitForIndex(`${baseUrl}/index.json`);
    const stories = Object.values(index.entries).filter((entry) => entry.type === "story");
    if (stories.length === 0) throw new Error("storybook reported no stories");

    browser = await puppeteer.launch({ executablePath, headless: true });
    const { counts, detail } = await scan(await browser.newPage(), baseUrl, stories);

    console.log(`checked ${stories.length} stories`);
    if (detail.length > 0) console.log(detail.join("\n"));
    process.exitCode = judge(counts, process.argv.includes("--update-baseline"));
  } finally {
    await browser?.close();
    storybook.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
