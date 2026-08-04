/**
 * Byte budget for the studio's eagerly-loaded JavaScript.
 *
 * Reads the built `dist/index.html`, resolves every script the browser must
 * fetch before it can render anything, gzips them, and fails above
 * EAGER_ENTRY_CHUNK_GZIP_RATCHET_BYTES. No browser and no dev server, so it is
 * cheap enough to run on every studio PR.
 *
 * "Eagerly loaded" deliberately means the entry module PLUS the chunks it
 * statically imports (which Vite emits as `<link rel="modulepreload">`), not
 * just the entry file. Measuring the entry file alone would let the
 * `manualChunks` config in vite.config.ts move bytes out of the number without
 * moving them off the critical path: on the current build the entry file alone
 * gzips to 444 KB and would report a pass, while the browser actually downloads
 * 861 KB before first paint.
 *
 * Usage: bun tests/e2e/studio-bundle-budget.mjs [distDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/**
 * The target — met as of the AST/DOM-stack removal (measured 604,332B).
 *
 * Getting here took the Node-only AST/DOM stack off the first-paint path:
 * recast / @babel/parser / esprima / ast-types / source-map left the browser
 * graph entirely when `isStudioHoldSet` moved out of the recast-importing
 * gsapParser.ts, and linkedom (+ htmlparser2 / css-select / domutils / cssom /
 * entities) moved behind the dynamic `import("@hyperframes/sdk")` in
 * src/utils/sdkLazy.ts plus the `sdk-parse` manualChunks rule that keeps the
 * `/node_modules/` catch-all from folding it back into eager `vendor`.
 */
export const EAGER_ENTRY_CHUNK_GZIP_TARGET_BYTES = 600 * 1024;
/**
 * What the gate enforces: a ratchet just above the measured 604,332B, so what
 * has been won cannot be given back. It may only ever move down. It sits above
 * rather than at the target so ordinary churn does not flip the check red — a
 * permanently red check gets muted, and would protect nothing.
 */
export const EAGER_ENTRY_CHUNK_GZIP_RATCHET_BYTES = 610_000;

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = resolve(HERE, "../../dist");

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

/**
 * @param {string} html contents of dist/index.html
 * @returns {{ entries: string[], preloads: string[] }} asset URLs, as authored
 */
export function findEagerAssets(html) {
  const entries = [...html.matchAll(/<script\b[^>]*>/gi)].flatMap(([tag]) => {
    const src = attribute(tag, "src");
    return attribute(tag, "type")?.toLowerCase() === "module" && src ? [src] : [];
  });
  const preloads = [...html.matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
    const href = attribute(tag, "href");
    return attribute(tag, "rel")?.toLowerCase() === "modulepreload" && href ? [href] : [];
  });
  return { entries, preloads };
}

function resolveAsset(distDir, url) {
  const pathname = decodeURIComponent(new URL(url, "https://studio.invalid").pathname);
  const filePath = resolve(distDir, `.${pathname}`);
  if (relative(distDir, filePath).startsWith("..")) {
    throw new Error(`Asset resolves outside dist: ${url}`);
  }
  if (!existsSync(filePath)) {
    throw new Error(`index.html references a missing asset: ${filePath}`);
  }
  return filePath;
}

function line(name, measured, budget, passed, unit = "") {
  const status = passed ? "PASS" : "FAIL";
  return `[StudioBundleBudget] ${status} ${name} measured=${measured}${unit} budget=${budget}${unit}`;
}

/**
 * @param {string} distDir directory holding the built index.html
 * @param {number} budgetGzipBytes
 * @returns {{ passed: boolean, report: string, gzipBytes: number }}
 */
export function checkEagerBundleBudget(distDir, budgetGzipBytes) {
  const indexPath = resolve(distDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`No built artifact at ${indexPath} — run \`vite build\` in packages/studio`);
  }

  const { entries, preloads } = findEagerAssets(readFileSync(indexPath, "utf8"));
  const lines = [line("eagerEntryModuleCount", entries.length, 1, entries.length === 1)];
  if (entries.length !== 1) {
    return { passed: false, report: lines.join("\n"), gzipBytes: 0 };
  }

  let gzipBytes = 0;
  for (const url of [entries[0], ...preloads]) {
    const bytes = gzipSync(readFileSync(resolveAsset(distDir, url))).byteLength;
    gzipBytes += bytes;
    lines.push(`[StudioBundleBudget] eager ${url} gzip=${bytes}B`);
  }

  const passed = gzipBytes <= budgetGzipBytes;
  lines.push(line("eagerEntryChunkGzipBytes", gzipBytes, budgetGzipBytes, passed, "B"));
  return { passed, report: lines.join("\n"), gzipBytes };
}

// Run the gate only when invoked directly, so the vitest suite can import the helpers.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    // The ratchet is enforced; the target is reported every run so the
    // remaining gap stays visible instead of quietly becoming the new normal.
    const { passed, report, gzipBytes } = checkEagerBundleBudget(
      resolve(process.argv[2] ?? DEFAULT_DIST),
      EAGER_ENTRY_CHUNK_GZIP_RATCHET_BYTES,
    );
    console.log(report);
    const target = EAGER_ENTRY_CHUNK_GZIP_TARGET_BYTES;
    if (passed && gzipBytes > target) {
      console.log(
        `[StudioBundleBudget] NOTE eager gzip ${gzipBytes}B is within the ${EAGER_ENTRY_CHUNK_GZIP_RATCHET_BYTES}B ratchet ` +
          `but still ${gzipBytes - target}B over the ${target}B target.`,
      );
    }
    if (passed && gzipBytes < target) {
      console.log("[StudioBundleBudget] target met — lower the ratchet to lock it in.");
    }
    if (!passed) process.exitCode = 1;
  } catch (error) {
    console.error(
      `[StudioBundleBudget] FAIL ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
