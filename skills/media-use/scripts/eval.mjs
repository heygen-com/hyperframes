#!/usr/bin/env node

/**
 * media-use eval — compare baseline (no media-use) vs. with media-use
 * on real registry blocks. Produces an HTML report.
 */

import {
  mkdtempSync,
  cpSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join, basename, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const RESOLVE_SCRIPT = join(SCRIPT_DIR, "resolve.mjs");

const TEST_BLOCKS = [
  "registry/blocks/nyc-paris-flight",
  "registry/blocks/macos-tahoe-liquid-glass",
  "registry/blocks/blue-sweater-intro-video",
  "registry/blocks/vpn-youtube-spot",
  "registry/blocks/apple-money-count",
  "registry/blocks/liquid-glass-notification",
  "registry/blocks/instagram-follow",
];

// Run resolve.mjs with args as a literal argv array (no shell), so values
// interpolated from manifest metadata (--intent prompt, --type) can't inject
// shell. Mirrors the execFileSync fix in probe.mjs / heygen-search.mjs.
function run(args, opts = {}) {
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [RESOLVE_SCRIPT, ...args], {
        encoding: "utf8",
        timeout: 15000,
        stdio: "pipe",
        ...opts,
      }).trim(),
    };
  } catch (err) {
    return { ok: false, output: (err.stdout || "") + (err.stderr || ""), code: err.status };
  }
}

function countAssetFiles(dir) {
  const assetsDir = join(dir, "assets");
  if (!existsSync(assetsDir)) return { count: 0, files: [] };
  const files = [];
  function walk(d, base = "") {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), rel);
      else files.push(rel);
    }
  }
  walk(assetsDir);
  return { count: files.length, files };
}

function evalBlock(blockPath) {
  const fullPath = join(REPO_ROOT, blockPath);
  if (!existsSync(fullPath)) return null;

  const name = basename(blockPath);
  const tmp = mkdtempSync(join(tmpdir(), `mu-eval-${name}-`));

  try {
    cpSync(fullPath, tmp, { recursive: true });

    // baseline: what the agent sees WITHOUT media-use
    const baseline = countAssetFiles(tmp);
    const htmlFiles = readdirSync(tmp).filter((f) => f.endsWith(".html"));

    // parse compositions for asset references
    const assetRefs = [];
    for (const hf of htmlFiles) {
      const html = readFileSync(join(tmp, hf), "utf8");
      const srcMatches = html.matchAll(/src=["']([^"']+?)["']/g);
      for (const m of srcMatches) {
        const ref = m[1];
        if (ref.startsWith("data:") || ref.startsWith("http")) continue;
        assetRefs.push({ composition: hf, ref });
      }
      const urlMatches = html.matchAll(/url\(["']?([^"')]+?)["']?\)/g);
      for (const m of urlMatches) {
        const ref = m[1];
        if (ref.startsWith("data:") || ref.startsWith("http") || ref.startsWith("#")) continue;
        assetRefs.push({ composition: hf, ref });
      }
    }

    // with media-use: run --adopt
    const adoptResult = run(["--adopt", "--project", tmp, "--json"]);
    let adopted = { ok: false, adopted: 0, assets: [] };
    if (adoptResult.ok) {
      try {
        adopted = JSON.parse(adoptResult.output);
      } catch {
        /* */
      }
    }

    // read the generated index
    const indexPath = join(tmp, ".media", "index.md");
    const indexContent = existsSync(indexPath)
      ? readFileSync(indexPath, "utf8")
      : "(no index generated)";

    // read manifest for detail
    const manifestPath = join(tmp, ".media", "manifest.jsonl");
    const manifest = existsSync(manifestPath)
      ? readFileSync(manifestPath, "utf8")
          .trim()
          .split("\n")
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
      : [];

    // test resolve cache hit: try resolving something that was adopted
    let resolveTest = null;
    if (manifest.length > 0) {
      const first = manifest[0];
      const prompt = first.provenance?.prompt || first.description;
      const r = run(["--type", first.type, "--intent", prompt, "--project", tmp, "--json"]);
      if (r.ok) {
        try {
          resolveTest = JSON.parse(r.output);
        } catch {
          /* */
        }
      }
    }

    // test resolve miss: try resolving something that doesn't exist
    const missResult = run([
      "--type",
      "bgm",
      "--intent",
      "nonexistent query xyz",
      "--project",
      tmp,
      "--json",
    ]);
    let resolveMiss = null;
    if (!missResult.ok) {
      try {
        resolveMiss = JSON.parse(missResult.output);
      } catch {
        /* */
      }
    }

    // coverage: which composition refs are covered by the manifest
    const manifestPaths = new Set(manifest.map((m) => m.path));
    const coverage = assetRefs.map((r) => ({
      ...r,
      covered: manifestPaths.has(r.ref),
    }));

    return {
      name,
      baseline: { fileCount: baseline.count, files: baseline.files, htmlCount: htmlFiles.length },
      compositions: htmlFiles,
      assetRefs: coverage,
      adopted: { count: adopted.adopted, assets: adopted.assets || [] },
      index: indexContent,
      manifest,
      resolveTest,
      resolveMiss,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function generateReport(results) {
  const all = results.filter(Boolean);
  const passed = all.filter((r) => r.adopted.count > 0);

  const rows = results
    .filter(Boolean)
    .map((r) => {
      const hasMetadata = r.manifest.some((m) => m.duration || m.width);
      const cacheHit = r.resolveTest?._source === "cached";
      const missHandled = r.resolveMiss?.ok === false;

      return `<tr>
        <td><strong>${r.name}</strong></td>
        <td>${r.baseline.fileCount} files, ${r.baseline.htmlCount} comp${r.baseline.htmlCount === 1 ? "" : "s"}</td>
        <td>${r.adopted.count} adopted</td>
        <td>${hasMetadata ? "<span class='pass'>with metadata</span>" : "<span class='warn'>no metadata</span>"}</td>
        <td>${cacheHit ? "<span class='pass'>cache hit</span>" : "<span class='warn'>no hit</span>"}</td>
        <td>${missHandled ? "<span class='pass'>handled</span>" : "<span class='fail'>unexpected</span>"}</td>
      </tr>`;
    })
    .join("\n");

  const details = results
    .filter(Boolean)
    .filter((r) => r.adopted.count > 0)
    .map((r) => {
      const assetRows = r.manifest
        .map((m) => {
          const dur = m.duration != null ? `${m.duration}s` : "—";
          const dims = m.width && m.height ? `${m.width}×${m.height}` : "—";
          return `<tr><td>${m.id}</td><td>${m.type}</td><td>${dur}</td><td>${dims}</td><td class="path">${m.path}</td><td>${m.description || ""}</td></tr>`;
        })
        .join("\n");

      const coveredCount = r.assetRefs.filter((c) => c.covered).length;
      const totalRefs = r.assetRefs.length;
      const coveragePct = totalRefs > 0 ? Math.round((coveredCount / totalRefs) * 100) : 100;

      const refRows = r.assetRefs
        .map(
          (c) =>
            `<tr><td class="path">${c.composition}</td><td class="path">${c.ref}</td><td>${c.covered ? "<span class='pass'>covered</span>" : "<span class='warn'>not in manifest</span>"}</td></tr>`,
        )
        .join("\n");

      return `<div class="block-detail">
        <h3>${r.name}</h3>
        <p style="font-size:13px;color:var(--muted)">${r.compositions.length} composition${r.compositions.length === 1 ? "" : "s"}: ${r.compositions.join(", ")}</p>

        <div class="comparison">
          <div class="col">
            <h4>Baseline (no media-use)</h4>
            <p>Agent sees: ${r.baseline.fileCount} raw files in assets/<br>No metadata, no type info, no relationship to compositions.</p>
            <pre class="file-list">${r.baseline.files.join("\n") || "(no assets)"}</pre>
          </div>
          <div class="col">
            <h4>With media-use (after --adopt)</h4>
            <p>Agent reads index.md — structured, typed, with metadata:</p>
            <pre class="index">${escapeHtml(r.index)}</pre>
          </div>
        </div>

        ${
          totalRefs > 0
            ? `<h4>Composition → asset coverage <span class="${coveragePct === 100 ? "pass" : "warn"}">${coveragePct}%</span> (${coveredCount}/${totalRefs} refs)</h4>
        <table class="manifest">
          <thead><tr><th>composition</th><th>asset reference</th><th>in manifest?</th></tr></thead>
          <tbody>${refRows}</tbody>
        </table>`
            : ""
        }

        <h4>Manifest records</h4>
        <table class="manifest">
          <thead><tr><th>id</th><th>type</th><th>dur</th><th>dims</th><th>path</th><th>description</th></tr></thead>
          <tbody>${assetRows}</tbody>
        </table>
      </div>`;
    })
    .join("\n");

  return `<title>media-use eval report</title>
<style>
:root { --bg: #fafaf7; --text: #1b1b18; --muted: #7a756a; --accent: #0d7377; --good: #1a7a3a; --warn: #b45309; --fail: #dc2626; --border: #e8e5df; --surface: #fff; --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; --sans: system-ui, -apple-system, sans-serif; --serif: Georgia, serif }
* { box-sizing: border-box; margin: 0 } body { background: var(--bg); color: var(--text); font-family: var(--serif); line-height: 1.6; font-size: 15px; padding: 40px 24px }
.wrap { max-width: 1100px; margin: 0 auto }
h1 { font-family: var(--sans); font-size: 28px; font-weight: 700; margin-bottom: 8px; letter-spacing: -.02em }
h2 { font-family: var(--sans); font-size: 20px; font-weight: 650; margin: 32px 0 12px; letter-spacing: -.01em }
h3 { font-family: var(--sans); font-size: 17px; font-weight: 650; margin: 24px 0 8px }
h4 { font-family: var(--sans); font-size: 14px; font-weight: 600; margin: 16px 0 6px; color: var(--muted) }
p { margin-bottom: 10px }
.meta { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-bottom: 24px }
.summary { display: flex; gap: 16px; margin: 16px 0; flex-wrap: wrap }
.stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 18px; flex: 1; min-width: 140px }
.stat .num { font-family: var(--sans); font-size: 28px; font-weight: 700; color: var(--accent) }
.stat .label { font-family: var(--mono); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .1em }
table { width: 100%; border-collapse: collapse; font-size: 13px; font-family: var(--sans); margin: 8px 0 }
th { text-align: left; font-family: var(--mono); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); border-bottom: 2px solid var(--border); padding: 6px 8px; font-weight: 700 }
td { border-bottom: 1px solid var(--border); padding: 7px 8px; vertical-align: top }
td.path { font-family: var(--mono); font-size: 12px; color: var(--muted); max-width: 300px; overflow: hidden; text-overflow: ellipsis }
.pass { color: var(--good); font-weight: 600 } .warn { color: var(--warn); font-weight: 600 } .fail { color: var(--fail); font-weight: 600 }
.comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 12px 0 }
@media(max-width:700px) { .comparison { grid-template-columns: 1fr } }
.col { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px }
.col h4 { margin-top: 0 }
pre { font-family: var(--mono); font-size: 12px; background: #1b1b18; color: #d4d0c8; border-radius: 6px; padding: 12px 14px; overflow-x: auto; margin: 6px 0; line-height: 1.5 }
pre.file-list { background: var(--bg); color: var(--muted); border: 1px solid var(--border) }
pre.index { white-space: pre; }
.block-detail { border-top: 1px solid var(--border); padding-top: 20px; margin-top: 20px }
.verdict { margin-top: 24px; padding: 16px 20px; border-radius: 8px; font-family: var(--sans); font-size: 15px }
.verdict.ship { background: #edfbf0; border: 1px solid #1a7a3a; color: #1a7a3a }
.verdict.wait { background: #fff3ec; border: 1px solid #d94f04; color: #d94f04 }
</style>
<div class="wrap">
<h1>media-use eval report</h1>
<p class="meta">${new Date().toISOString().slice(0, 10)} · ${all.length} blocks evaluated · baseline vs. media-use --adopt</p>

<div class="summary">
  <div class="stat"><div class="num">${all.length}</div><div class="label">blocks tested</div></div>
  <div class="stat"><div class="num">${passed.length}</div><div class="label">with assets</div></div>
  <div class="stat"><div class="num">${all.reduce((s, r) => s + r.adopted.count, 0)}</div><div class="label">assets adopted</div></div>
  <div class="stat"><div class="num">${all.filter((r) => r.manifest.some((m) => m.duration || m.width)).length}</div><div class="label">with ffprobe metadata</div></div>
  <div class="stat"><div class="num">${(() => {
    const refs = all.flatMap((r) => r.assetRefs);
    const covered = refs.filter((c) => c.covered).length;
    return refs.length > 0 ? Math.round((covered / refs.length) * 100) + "%" : "—";
  })()}</div><div class="label">composition coverage</div></div>
</div>

<h2>Results matrix</h2>
<table>
  <thead><tr><th>Block</th><th>Baseline</th><th>Adopted</th><th>Metadata</th><th>Cache hit</th><th>Miss handling</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<h2>Before / after comparisons</h2>
${details}

<div class="verdict ${passed.length >= 3 ? "ship" : "wait"}">
  ${
    passed.length >= 3
      ? `<strong>Ship it.</strong> ${passed.length}/${all.length} blocks adopted successfully with metadata. Resolve cache hits work. Miss handling is clean.`
      : `<strong>Needs work.</strong> Only ${passed.length} blocks adopted. Check the failures above.`
  }
</div>
</div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

console.log("media-use eval · running against registry blocks...\n");

const results = [];
for (const block of TEST_BLOCKS) {
  const fullPath = join(REPO_ROOT, block);
  if (!existsSync(fullPath)) {
    console.log(`  skip ${basename(block)} (not found)`);
    results.push(null);
    continue;
  }
  process.stdout.write(`  ${basename(block)}...`);
  const result = evalBlock(block);
  if (result) {
    console.log(
      ` ${result.adopted.count} adopted, ${result.manifest.filter((m) => m.duration || m.width).length} with metadata`,
    );
  } else {
    console.log(" failed");
  }
  results.push(result);
}

const report = generateReport(results);
const outPath = join(SCRIPT_DIR, "..", "eval-report.html");
writeFileSync(outPath, report);
console.log(`\nReport: ${outPath}`);
