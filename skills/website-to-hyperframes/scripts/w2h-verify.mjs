#!/usr/bin/env node
// w2h-verify.mjs — verification report for a website-to-hyperframes project.
//
// Computes quality signals the agent cannot fudge. Each check is designed to
// catch a specific failure mode observed across three real agent debriefs.
// Result becomes the Step 6 deliverable — paste verbatim into the final
// user-facing summary so the user sees exactly what shipped.
//
// Pure file analysis. No shell spawns. Run lint + inspect separately and
// paste alongside.
//
// Usage:
//   node skills/website-to-hyperframes/scripts/w2h-verify.mjs <project-dir>
//
// Exit codes:
//   0 = all gates pass
//   1 = one or more gates failed
//   2 = script error (project-dir missing, etc.)

import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

const PROJECT_DIR = resolve(process.argv[2] || ".");

// Thresholds — change here, not by interpretation.
const HEADLINE_MIN_PX = 80; // 80px floor for primary headline at 1920×1080
const TIMELINE_COVERAGE_MIN = 0.7; // max GSAP event position must reach ≥70% of beat duration
const SFX_DRIFT_TOLERANCE_S = 0.1; // 3 frames at 30fps; matches step-5 evidence rule + step-6 playback floor
const BEAT_DURATION_DRIFT_TOLERANCE_S = 0.5;

const SHADER_NAMES = [
  "cross-warp-morph",
  "cross-warp",
  "cinematic-zoom",
  "gravitational-lens",
  "glitch",
  "light-leak",
  "flash-through-white",
  "whip-pan",
  "domain-warp",
  "thermal-bloom",
  "swirl",
  "ridged-noise",
  "sdf-reveal",
  "chromatic-aberration",
  "ripple",
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(PROJECT_DIR)) {
    console.error(`✗ Project directory not found: ${PROJECT_DIR}`);
    process.exit(2);
  }

  const results = [];
  results.push(await checkRequiredArtifacts());
  results.push(await checkBrandVisualsUsed());
  results.push(await checkPerBeatHeadlineSize());
  results.push(await checkPerBeatTimelineCoverage());
  results.push(await checkShaderTransitionsConsistency());
  results.push(await checkSfxTimestampConsistency());
  results.push(await checkBeatDurationConsistency());
  results.push(await checkMp4Exists());

  printReport(results);

  const anyFail = results.some((r) => r.status === "FAIL");
  process.exit(anyFail ? 1 : 0);
}

// ─── Checks ──────────────────────────────────────────────────────────────────

async function checkRequiredArtifacts() {
  const required = ["STORYBOARD.md", "DESIGN.md", "SCRIPT.md", "index.html"];
  const missing = required.filter((f) => !existsSync(join(PROJECT_DIR, f)));
  if (missing.length === 0) {
    return { name: "Required artifacts", status: "PASS", detail: required.join(", ") };
  }
  return {
    name: "Required artifacts",
    status: "FAIL",
    detail: `missing: ${missing.join(", ")}`,
  };
}

// Catches the biggest failure mode: agent uses only the logo and rebuilds
// every "hero illustration" from CSS, ignoring the brand's actual visual identity.
async function checkBrandVisualsUsed() {
  const compositions = await readBeatCompositions();
  if (compositions.length === 0) {
    return { name: "Brand visuals used", status: "INFO", detail: "no beat compositions found" };
  }

  // A "brand visual" is anything captured under capture/assets/ that ISN'T:
  //   - a font file
  //   - a logo file (filename contains "logo")
  //   - a favicon / apple-touch-icon
  // i.e., hero-*.jpg, image-*.png, illustrations, photographs, svgs/<icons>.svg
  const brandRegex =
    /capture\/assets\/(?!fonts\/)(?:svgs\/)?(?!.*(?:logo|favicon|apple-touch-icon))[\w-]+\.(?:jpg|jpeg|png|svg|webp|gif)/gi;
  const beatsUsingBrand = [];
  for (const beat of compositions) {
    const matches = beat.content.match(brandRegex) || [];
    if (matches.length > 0) {
      beatsUsingBrand.push({ beat: beat.name, count: new Set(matches).size });
    }
  }

  const pass = beatsUsingBrand.length >= 1;
  if (pass) {
    return {
      name: "Brand visuals used",
      status: "PASS",
      detail: `${beatsUsingBrand.length}/${compositions.length} beats reference a hero/image/svg captured asset`,
      extra:
        beatsUsingBrand.length === 1
          ? "Only 1 beat uses a captured visual — consider whether the brand's hero illustrations or signature graphics fit other beats too."
          : null,
    };
  }
  return {
    name: "Brand visuals used",
    status: "FAIL",
    detail: `0/${compositions.length} beats reference any hero-*/image-*/svgs/ captured asset (logo doesn't count)`,
    extra:
      "Open capture/assets/contact-sheet-*.jpg and capture/assets/svgs/contact-sheet-*.jpg. The brand's actual visuals are sitting there. Rebuilding them in CSS erases what makes the brand recognizable.",
  };
}

// Catches "headlines too small to read" — inspect typically catches the
// overflow afterward, but this catches the cause earlier.
async function checkPerBeatHeadlineSize() {
  const compositions = await readBeatCompositions();
  if (compositions.length === 0) {
    return { name: "Headline font-size", status: "INFO", detail: "no beat compositions found" };
  }

  // Only flag beats where the LARGEST font-size is in the "aspiring headline
  // but too small" range (40–<80px). Below 40px = the beat has no headline by
  // design (UI labels, code text, decorative). ≥80px = proper headline.
  // This skips legitimate non-headline beats (terminal beats, SVG-only beats,
  // pure-image beats) without losing the real "headline too small" signal.
  const HEADLINE_FLOOR_FOR_CHECK = 40;
  const offenders = [];
  const skipped = [];
  for (const beat of compositions) {
    const sizes = [...beat.content.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) =>
      parseFloat(m[1]),
    );
    if (sizes.length === 0) {
      skipped.push({ beat: beat.name, reason: "no font-size declared" });
      continue;
    }
    const max = Math.max(...sizes);
    if (max < HEADLINE_FLOOR_FOR_CHECK) {
      skipped.push({ beat: beat.name, reason: `largest font is ${max}px — no headline by design` });
      continue;
    }
    if (max < HEADLINE_MIN_PX) {
      offenders.push({ beat: beat.name, maxSize: max });
    }
  }

  const pass = offenders.length === 0;
  const checked = compositions.length - skipped.length;
  return {
    name: "Headline font-size",
    status: pass ? "PASS" : "FAIL",
    detail: pass
      ? `${checked}/${compositions.length} beats with a headline-sized text element, all ≥${HEADLINE_MIN_PX}px`
      : `${offenders.length} beat(s) with headline-sized text below ${HEADLINE_MIN_PX}px floor`,
    extra: pass
      ? null
      : [
          ...offenders.map((o) => `${o.beat}: largest font-size is ${o.maxSize}px`),
          ...(skipped.length > 0
            ? [
                `(skipped ${skipped.length} beat(s) with no headline-sized text: ${skipped.map((s) => s.beat).join(", ")})`,
              ]
            : []),
        ].join("\n  "),
  };
}

// Catches "webpage not shot" failures — entrance tweens in the first second
// then nothing. Snapshots look fine (static end state) but motion is dead.
async function checkPerBeatTimelineCoverage() {
  const compositions = await readBeatCompositions();
  const beatDurations = await readBeatDurationsFromIndex();
  if (compositions.length === 0) {
    return { name: "Timeline coverage", status: "INFO", detail: "no beat compositions found" };
  }

  const offenders = [];
  const skipped = [];
  // Pattern detectors: beats that use these idioms have events at positions
  // the static parser can't read (loop iterators, variable arithmetic).
  // Don't flag them as "webpage not shot" — they have events the parser
  // simply can't see. Note: single-tween yoyo/repeat is NOT enough to skip
  // — it only oscillates one element, not the whole beat.
  const dynamicPatterns = [
    {
      name: "forEach with tweens",
      re: /\.forEach\s*\([^{]*\{[\s\S]{0,2000}?\btl\.(?:to|set|fromTo|from)\(/,
    },
    {
      name: "for-loop with tweens",
      re: /\bfor\s*\([^)]*\)\s*\{[\s\S]{0,2000}?\btl\.(?:to|set|fromTo|from)\(/,
    },
  ];

  for (const beat of compositions) {
    const beatId = beat.name.replace(/\.html$/, "");
    const dur = beatDurations[beatId] ?? beatDurations[beat.name];
    if (!dur) {
      skipped.push({ beat: beat.name, reason: "no data-duration in index.html" });
      continue;
    }

    // Check for dynamic patterns first — if present, coverage cannot be
    // statically determined; treat as informational, not a failure.
    const matchedDynamic = dynamicPatterns.find((p) => p.re.test(beat.content));
    if (matchedDynamic) {
      skipped.push({
        beat: beat.name,
        reason: `dynamic event pattern detected (${matchedDynamic.name}) — coverage not statically measurable`,
      });
      continue;
    }

    // Long-duration tween check: if there's a tween with duration ≥ 70% of
    // beat duration, that single tween covers the whole beat — likely a
    // camera dolly, breathing animation, or persistent motion. Skip the
    // position-based coverage check.
    const durationRe = /\btl\.(?:to|set|fromTo|from)\([\s\S]{0,500}?duration:\s*([0-9.]+)/g;
    let dm;
    let hasLongTween = false;
    let longTweenDur = 0;
    while ((dm = durationRe.exec(beat.content)) !== null) {
      const d = parseFloat(dm[1]);
      if (d >= dur * TIMELINE_COVERAGE_MIN) {
        hasLongTween = true;
        longTweenDur = d;
        break;
      }
    }
    if (hasLongTween) {
      skipped.push({
        beat: beat.name,
        reason: `long-duration tween covers ${longTweenDur.toFixed(2)}s of ${dur.toFixed(2)}s beat — full coverage via persistent motion`,
      });
      continue;
    }

    // Extract GSAP event positions for static cases.
    // Use balanced-paren scanning so multi-line calls and rgba(...) values
    // inside option objects don't false-match.
    const positions = extractTopLevelPositionArgs(beat.content);
    if (positions.length === 0) {
      offenders.push({ beat: beat.name, reason: "no GSAP events with explicit position found" });
      continue;
    }

    const maxPos = Math.max(...positions);
    const coverage = maxPos / dur;
    if (coverage < TIMELINE_COVERAGE_MIN) {
      offenders.push({
        beat: beat.name,
        reason: `static events span 0–${maxPos.toFixed(2)}s of ${dur.toFixed(2)}s beat (${Math.round(coverage * 100)}%)`,
      });
    }
  }

  const pass = offenders.length === 0;
  const checked = compositions.length - skipped.length;
  return {
    name: "Timeline coverage",
    status: pass ? "PASS" : "FAIL",
    detail: pass
      ? `${checked}/${compositions.length} statically-measurable beats span ≥${Math.round(TIMELINE_COVERAGE_MIN * 100)}% of duration`
      : `${offenders.length} beat(s) below ${Math.round(TIMELINE_COVERAGE_MIN * 100)}% static coverage — likely "webpage not shot" failures`,
    extra:
      [
        ...offenders.map((o) => `${o.beat}: ${o.reason}`),
        ...(skipped.length > 0 ? skipped.map((s) => `(skipped ${s.beat}: ${s.reason})`) : []),
      ].join("\n  ") || null,
  };
}

async function checkShaderTransitionsConsistency() {
  const storyboardPath = join(PROJECT_DIR, "STORYBOARD.md");
  const indexPath = join(PROJECT_DIR, "index.html");
  if (!existsSync(storyboardPath) || !existsSync(indexPath)) {
    return {
      name: "Shader transitions",
      status: "INFO",
      detail: "STORYBOARD.md or index.html missing — cannot check",
    };
  }

  const storyboard = await readFile(storyboardPath, "utf-8");
  const index = await readFile(indexPath, "utf-8");

  // For each shader name, count it as "declared" only if it appears in a
  // transition-use context — NOT in an inventory list (3+ names on one line)
  // and NOT exclusively as part of an SFX filename (sfx/glitch-1.mp3).
  const sbLines = storyboard.split("\n");
  // Longest-name matching to avoid substring double-counting.
  const sortedNames = [...SHADER_NAMES].sort((a, b) => b.length - a.length);
  const seen = new Set();
  const declared = [];
  for (const name of sortedNames) {
    let foundInUseContext = false;
    for (const line of sbLines) {
      if (seen.has(name)) break;
      if (!line.includes(name)) continue;
      // Skip inventory listing lines (3+ shader names on one line).
      const namesOnLine = SHADER_NAMES.filter((n) => line.includes(n)).length;
      if (namesOnLine >= 3) continue;
      // Skip lines where the shader name only appears in SFX filename context.
      const sfxContext = line.includes(`sfx/${name}`) || line.includes(`sfx-${name}`);
      // Count this name if it appears in a non-SFX, non-inventory line.
      if (!sfxContext) {
        foundInUseContext = true;
        break;
      }
    }
    if (foundInUseContext) {
      declared.push(name);
      seen.add(name);
    }
  }
  if (declared.length === 0) {
    return {
      name: "Shader transitions",
      status: "PASS",
      detail: "STORYBOARD declared none — no shader transitions expected",
    };
  }

  // A shader is "present" only if HyperShader runtime is in index.html AND the
  // shader name appears in a line that is NOT an SFX reference.
  const hasHyperShader = /HyperShader\s*[(.]/.test(index);
  const indexLines = index.split("\n");
  const present = !hasHyperShader
    ? []
    : declared.filter((name) =>
        indexLines.some((line) => {
          if (!line.includes(name)) return false;
          if (line.includes(`sfx/${name}`) || line.includes(`sfx-${name}`)) return false;
          return true;
        }),
      );
  const missing = declared.filter((name) => !present.includes(name));
  const pass = missing.length === 0;

  return {
    name: "Shader transitions",
    status: pass ? "PASS" : "FAIL",
    detail: `STORYBOARD declared ${declared.length}, ${present.length} present in index.html, ${missing.length} missing`,
    extra: pass
      ? null
      : `Missing from build: ${missing.join(", ")}. STORYBOARD.md and index.html disagree — either re-add the transitions or update STORYBOARD.md.`,
  };
}

async function checkSfxTimestampConsistency() {
  const storyboardPath = join(PROJECT_DIR, "STORYBOARD.md");
  const indexPath = join(PROJECT_DIR, "index.html");
  if (!existsSync(storyboardPath) || !existsSync(indexPath)) {
    return {
      name: "SFX timestamps",
      status: "INFO",
      detail: "STORYBOARD.md or index.html missing",
    };
  }

  const storyboard = await readFile(storyboardPath, "utf-8");
  const index = await readFile(indexPath, "utf-8");

  const sfxRefs = [];
  for (const line of storyboard.split("\n")) {
    const fileMatch = line.match(/sfx\/([\w-]+\.mp3)/);
    // Require trailing `s` so we capture the time column, not the volume column.
    const timeMatch = line.match(/\|\s*(\d+(?:\.\d+)?)s\b/);
    if (fileMatch && timeMatch) {
      sfxRefs.push({ file: fileMatch[1], storyboardT: parseFloat(timeMatch[1]) });
    }
  }

  if (sfxRefs.length === 0) {
    return {
      name: "SFX timestamps",
      status: "INFO",
      detail: "No SFX entries detected in STORYBOARD.md",
    };
  }

  // Collect ALL audio tags per file (multi-timestamp SFX like click.mp3 have
  // 3 tags). Use a two-step extraction so we don't depend on src= and
  // data-start= attribute ordering — the documented canonical pattern in
  // capabilities.md puts src= LAST in the tag, which an order-dependent
  // regex would miss → false MISSING reports.
  const indexSfx = new Map();
  const audioTagRegex = /<audio[^>]*?>/g;
  let tagMatch;
  while ((tagMatch = audioTagRegex.exec(index)) !== null) {
    const tag = tagMatch[0];
    const srcMatch = tag.match(/src=["'](?:[^"']*\/)?sfx\/([\w-]+\.mp3)["']/);
    const dsMatch = tag.match(/data-start=["']([0-9.]+)["']/);
    if (!srcMatch || !dsMatch) continue;
    const file = srcMatch[1];
    const t = parseFloat(dsMatch[1]);
    if (!indexSfx.has(file)) indexSfx.set(file, []);
    indexSfx.get(file).push(t);
  }

  const drifts = [];
  const missing = [];
  for (const ref of sfxRefs) {
    if (!indexSfx.has(ref.file)) {
      missing.push(ref.file);
      continue;
    }
    const indexTs = indexSfx.get(ref.file);
    const closest = indexTs.reduce((best, t) =>
      Math.abs(t - ref.storyboardT) < Math.abs(best - ref.storyboardT) ? t : best,
    );
    const drift = Math.abs(closest - ref.storyboardT);
    if (drift > SFX_DRIFT_TOLERANCE_S) {
      drifts.push({ file: ref.file, storyboardT: ref.storyboardT, indexT: closest, drift });
    }
  }

  const indexCount = [...indexSfx.values()].reduce((sum, arr) => sum + arr.length, 0);
  const pass = missing.length === 0 && drifts.length === 0;
  return {
    name: "SFX timestamps",
    status: pass ? "PASS" : "FAIL",
    detail: `${sfxRefs.length} SFX in STORYBOARD · ${indexCount} in index.html · ${missing.length} missing · ${drifts.length} drifted >${SFX_DRIFT_TOLERANCE_S}s`,
    extra: pass
      ? null
      : [
          ...missing.map((f) => `MISSING in index.html: ${f}`),
          ...drifts.map(
            (d) =>
              `DRIFT: ${d.file} storyboard=${d.storyboardT}s closest index=${d.indexT}s drift=${d.drift.toFixed(2)}s`,
          ),
        ].join("\n  "),
  };
}

// Catches storyboard staleness on beat timings — agent shipped with different
// beat durations than the storyboard documented, leaving the spec lying.
async function checkBeatDurationConsistency() {
  const storyboardPath = join(PROJECT_DIR, "STORYBOARD.md");
  if (!existsSync(storyboardPath)) {
    return { name: "Beat durations", status: "INFO", detail: "STORYBOARD.md missing" };
  }

  const storyboard = await readFile(storyboardPath, "utf-8");
  const indexDurations = await readBeatDurationsFromIndex();
  // Filter to only numbered beats (beat-1, beat-2, ...). Skip "main" / root
  // composition and any non-numbered placeholders.
  const buildBeatIds = Object.keys(indexDurations).filter((id) => /^beat-\d+/i.test(id));
  if (buildBeatIds.length === 0) {
    return {
      name: "Beat durations",
      status: "INFO",
      detail: "no numbered beat data-duration in index.html",
    };
  }

  // Parse storyboard beat durations. The expected pattern is a timing-table row:
  //   | B4 — MetaBrain | 16.600 – 21.000s | ... |
  // We extract start–end and compute duration = end - start. Falls back to a
  // direct duration mention ("duration: X.Xs") if the range format isn't found.
  // A beat with no parseable duration is skipped — we don't flag missing rows.
  const drifts = [];
  const unparseable = [];
  for (const beatId of buildBeatIds) {
    const num = beatId.match(/beat-(\d+)/i)?.[1];
    if (!num) continue;
    let storyT = null;

    // Strategy 1: standalone beat row "B4 — Name | 16.600 – 21.000s |".
    // Require `B${num}` to be followed by a non-digit-non-dot char so "B3.1"
    // doesn't false-match for B3.
    const rangeRe = new RegExp(
      `\\bB${num}(?![\\.\\d])[^\\n|]*\\|\\s*(\\d+(?:\\.\\d+)?)s?\\s*[–-]\\s*(\\d+(?:\\.\\d+)?)s`,
      "i",
    );
    const rm = storyboard.match(rangeRe);
    if (rm) {
      storyT = parseFloat(rm[2]) - parseFloat(rm[1]);
    } else {
      // Strategy 2: sum sub-beats "B${num}.X — ... | start – end s |".
      // Useful when a beat is broken into sub-rows (B3.1, B3.2, ...) instead
      // of having a standalone row.
      const subRe = new RegExp(
        `\\bB${num}\\.\\d+\\b[^\\n|]*\\|\\s*(\\d+(?:\\.\\d+)?)s?\\s*[–-]\\s*(\\d+(?:\\.\\d+)?)s`,
        "gi",
      );
      let sum = 0;
      let count = 0;
      let mm;
      while ((mm = subRe.exec(storyboard)) !== null) {
        sum += parseFloat(mm[2]) - parseFloat(mm[1]);
        count++;
      }
      if (count > 0) storyT = sum;
    }

    if (storyT === null) {
      // Strategy 3: bare-number timing table — "| 1 | 0.00s | 5.20s | 5.20s |"
      // (Beat | Start | End | Duration). The duration column is the 4th cell,
      // OR derive from end - start (columns 2 and 3). Match a row that starts
      // with `| <num> |` and has at least 2 time cells.
      // Allow optional leading `>` (blockquote) before the pipe.
      const tableRe = new RegExp(
        `^\\s*>?\\s*\\|\\s*${num}\\s*\\|\\s*(\\d+(?:\\.\\d+)?)s?\\s*\\|\\s*(\\d+(?:\\.\\d+)?)s`,
        "im",
      );
      const tm = storyboard.match(tableRe);
      if (tm) {
        const start = parseFloat(tm[1]);
        const end = parseFloat(tm[2]);
        storyT = end - start;
      }
    }
    // Note: removed the previous "duration: X.Xs near beat label" fallback —
    // it false-matched non-beat durations (e.g., "shader runs — duration 0.7s"
    // near a "Beat 1" mention). If a storyboard's timing format isn't a clean
    // range or table row, the beat is reported as unparseable rather than
    // guessed at.

    if (storyT === null) {
      unparseable.push(beatId);
      continue;
    }
    const buildT = indexDurations[beatId];
    const drift = Math.abs(storyT - buildT);
    if (drift > BEAT_DURATION_DRIFT_TOLERANCE_S) {
      drifts.push({ beat: beatId, storyboardDuration: storyT, buildDuration: buildT, drift });
    }
  }

  const parseable = buildBeatIds.length - unparseable.length;
  if (drifts.length === 0) {
    return {
      name: "Beat durations",
      status: "PASS",
      detail: `${parseable}/${buildBeatIds.length} beats parseable, storyboard durations match within ±${BEAT_DURATION_DRIFT_TOLERANCE_S}s`,
      extra:
        unparseable.length > 0
          ? `(skipped: ${unparseable.join(", ")} — could not find duration in STORYBOARD.md)`
          : null,
    };
  }
  return {
    name: "Beat durations",
    status: "FAIL",
    detail: `${drifts.length} beat(s) drift between STORYBOARD.md and index.html > ${BEAT_DURATION_DRIFT_TOLERANCE_S}s`,
    extra: [
      ...drifts.map(
        (d) =>
          `${d.beat}: storyboard=${d.storyboardDuration.toFixed(2)}s build=${d.buildDuration}s drift=${d.drift.toFixed(2)}s`,
      ),
      ...(unparseable.length > 0
        ? [`(skipped: ${unparseable.join(", ")} — could not find duration in STORYBOARD.md)`]
        : []),
    ].join("\n  "),
  };
}

async function checkMp4Exists() {
  const candidates = [PROJECT_DIR, join(PROJECT_DIR, "output"), join(PROJECT_DIR, "renders")];
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    try {
      const files = await readdir(dir);
      if (files.some((f) => f.endsWith(".mp4"))) {
        return {
          name: "Rendered MP4",
          status: "PASS",
          detail: `found .mp4 in ${dir.replace(PROJECT_DIR, ".")}`,
        };
      }
    } catch {
      /* ignore */
    }
  }
  return {
    name: "Rendered MP4",
    status: "INFO",
    detail:
      "no .mp4 found — preview-only delivery; if claiming verified motion, render is required (Path 2 of audio+motion verification)",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Cached so multiple checks don't re-read the same files. The script is a
// one-shot CLI so a process-scoped cache is fine; no invalidation needed.
let _compositionsCache = null;
async function readBeatCompositions() {
  if (_compositionsCache) return _compositionsCache;
  const dir = join(PROJECT_DIR, "compositions");
  if (!existsSync(dir)) {
    _compositionsCache = [];
    return _compositionsCache;
  }
  const files = await readdir(dir);
  const beats = files.filter((f) => /^beat-/i.test(f) && f.endsWith(".html"));
  const out = [];
  for (const f of beats) {
    const content = await readFile(join(dir, f), "utf-8");
    out.push({ name: f, content });
  }
  _compositionsCache = out;
  return out;
}

// Extract the trailing numeric position argument from each `tl.<method>(...)`
// call in a script. Uses balanced-paren scanning so multi-line calls and
// nested patterns like rgba(86,131,218,0.35) don't false-match.
function extractTopLevelPositionArgs(content) {
  const positions = [];
  const methodRe = /\btl\.(?:to|set|fromTo|from|call|add)\(/g;
  let startMatch;
  while ((startMatch = methodRe.exec(content)) !== null) {
    let i = startMatch.index + startMatch[0].length;
    let depth = 1;
    let lastTopLevelCommaIdx = -1;
    let inString = false;
    let stringChar = null;
    while (i < content.length && depth > 0) {
      const c = content[i];
      if (inString) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === stringChar) inString = false;
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        inString = true;
        stringChar = c;
        i++;
        continue;
      }
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") {
        depth--;
        if (depth === 0) break;
      } else if (c === "," && depth === 1) lastTopLevelCommaIdx = i;
      i++;
    }
    if (depth === 0 && lastTopLevelCommaIdx > 0) {
      const lastArg = content.substring(lastTopLevelCommaIdx + 1, i).trim();
      const numMatch = lastArg.match(/^([0-9.]+)$/);
      if (numMatch) positions.push(parseFloat(numMatch[1]));
    }
  }
  return positions;
}

// Returns a map of { "beat-1-name": durationInSeconds, ... } from index.html.
// Cached per-process (one-shot CLI, no invalidation needed).
let _beatDurationsCache = null;
async function readBeatDurationsFromIndex() {
  if (_beatDurationsCache) return _beatDurationsCache;
  const indexPath = join(PROJECT_DIR, "index.html");
  if (!existsSync(indexPath)) {
    _beatDurationsCache = {};
    return _beatDurationsCache;
  }
  const content = await readFile(indexPath, "utf-8");
  const map = {};

  // Pattern: <div data-composition-id="beat-N-name" ... data-duration="5.5" ...>
  // OR: data-composition-src="compositions/beat-N-name.html" ... data-duration="5.5"
  const divRegex = /<div[^>]*?>/g;
  let m;
  while ((m = divRegex.exec(content)) !== null) {
    const tag = m[0];
    const idMatch = tag.match(/data-composition-id=["']([^"']+)["']/);
    const srcMatch = tag.match(/data-composition-src=["'][^"']*?\/?(beat-[\w-]+)\.html["']/);
    const durMatch = tag.match(/data-duration=["']([0-9.]+)["']/);
    if (!durMatch) continue;
    const dur = parseFloat(durMatch[1]);
    if (idMatch) map[idMatch[1]] = dur;
    if (srcMatch) map[srcMatch[1]] = dur;
  }
  _beatDurationsCache = map;
  return map;
}

// ─── Report ──────────────────────────────────────────────────────────────────

function printReport(results) {
  const cols = { name: 26, status: 8, detail: 60 };
  const line = "─".repeat(cols.name + cols.status + cols.detail + 6);

  console.log("");
  console.log(`w2h-verify · ${PROJECT_DIR}`);
  console.log(line);
  console.log("Check".padEnd(cols.name) + " │ " + "Status".padEnd(cols.status) + " │ " + "Detail");
  console.log(line);

  for (const r of results) {
    const symbol = r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : "·";
    console.log(
      r.name.padEnd(cols.name) +
        " │ " +
        `${symbol} ${r.status}`.padEnd(cols.status) +
        " │ " +
        (r.detail || ""),
    );
    if (r.extra) {
      const indent = " ".repeat(cols.name + cols.status + 6 + 4);
      console.log(
        "".padEnd(cols.name) +
          " │ " +
          "".padEnd(cols.status) +
          " │   " +
          r.extra.split("\n").join("\n" + indent),
      );
    }
  }

  console.log(line);
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const info = results.filter((r) => r.status === "INFO").length;
  console.log(`SUMMARY: ${pass} PASS · ${fail} FAIL · ${info} INFO`);

  if (fail > 0) {
    console.log("");
    console.log("Step 6 NOT done. Fix FAIL items, OR include this report verbatim in your final");
    console.log("summary's \"What I did NOT verify\" section so the user knows what's broken.");
  } else {
    console.log("");
    console.log(
      "All gates pass. Paste this report into your final user-facing summary as evidence.",
    );
  }
  console.log("");
}

main().catch((e) => {
  console.error("w2h-verify script error:", e);
  process.exit(2);
});
