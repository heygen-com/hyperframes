import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every ffprobe/ffmpeg invocation must terminate its options with `--`
 * IMMEDIATELY before the input path.
 *
 * Source-level and DISCOVERY-based on purpose. Two prior attempts failed
 * differently and both reported the bug class closed:
 *
 *  - #2740 fixed one of ten call sites and asserted the argv of that one site.
 *  - Its follow-up scanned a hardcoded file list for a format flag followed by
 *    a bare identifier, which only matched the shape it was written against —
 *    mutation-testing showed removal of `--` from `engine/utils/ffprobe.ts`
 *    and `cli/commands/init.ts` did not fail it.
 *
 * So this walks the tree, finds the callers itself, and checks the TERMINATOR
 * POSITION rather than its mere presence. A new caller is discovered rather
 * than needing to be remembered.
 */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

/**
 * Roots to sweep.
 *
 * `skills/` is here because leaving it out was not a scoping choice, it was a
 * hole: the shipped agent tools under `skills/**` spawn ffprobe directly, and
 * 17 of those call sites were missing the terminator while this suite reported
 * the bug class closed. They are distributed to users, not fixtures.
 */
const SWEEP_ROOTS = ["packages", "skills", "scripts"];

/** `.mjs`/`.cjs` are first-class here — the skill scripts are not TypeScript. */
const SOURCE_EXT = /\.(?:ts|mjs|cjs|js|py|sh)$/;

/**
 * Shell-syntax invocations, checked separately and more weakly.
 *
 * A JS/Python argv is a bracketed literal, so the parser above can check that
 * `--` is the PENULTIMATE entry. A shell command line is not a literal —
 * `ffprobe -v error ... "$BG" 2>/dev/null | tr -dc '0-9.'` has redirections,
 * pipes and substitutions after the input — so checking position would need a
 * shell parser. This asserts the terminator is PRESENT on any ffprobe command
 * line, which is weaker but is the part that was missing, and it is honest
 * about being weaker rather than implying the same guarantee.
 */
const SHELL_EXT = /\.sh$/;

/**
 * The caller set as of the sweep that introduced this contract.
 *
 * Discovery is authoritative — a NEW caller is picked up without touching this
 * list. The manifest runs the comparison the other way: if a regex change or a
 * refactor drops a known caller out of discovery, every assertion for it stops
 * running and the suite still reports green. That silent-vacuum failure is how
 * the two previous versions of this test stayed passing over a live bug.
 */
const MANIFEST = [
  "packages/cli/src/commands/init.ts",
  "packages/cli/src/utils/webmAlphaCheck.ts",
  "packages/cli/src/whisper/transcribe.ts",
  "packages/core/src/mediaGradeAnalyzer.ts",
  "packages/engine/src/utils/ffprobe.ts",
  "packages/lint/src/hevcPreviewLint.ts",
  "packages/producer/src/plan-parity-analysis.ts",
  "packages/producer/src/services/render/audioPadTrim.ts",
  "packages/producer/src/utils/audioRegression.ts",
  "packages/studio-server/src/helpers/mediaMetadata.ts",
  "packages/studio-server/src/helpers/mediaValidation.ts",
];

/** Files that actually invoke ffprobe/ffmpeg, found rather than listed. */
/**
 * Runs ffprobe but produced no argv the matcher understood. Not necessarily a
 * bug — a file may only pass a probe path around — but it IS the blind spot,
 * so it is surfaced rather than dropped.
 */
function mentionsProbe(src: string): boolean {
  // The first argument of the spawn must itself name a probe binary. A looser
  // "file mentions ffprobe anywhere AND spawns anything" rule flagged four
  // files that build no argv at all: binary resolution (`ffBinaries.ts`,
  // `browser/ffmpeg.ts`), error-string matching (`videoFrameExtractor.ts`) and
  // prose (`mediaCodecMap.ts`).
  //
  // ponytail: names the binary at the call site; a caller that spawns through
  // an opaquely-named variable (`spawn(command, argv)`) is invisible here.
  // Those still get caught by argv matching whenever their flags are literal —
  // widen this if one ever slips through both.
  // Comments and doc prose describing a spawn are not a spawn:
  // `tts.test.mjs` explains `ffprobeDuration's spawnSync("ffprobe", ...) call`
  // in a comment and was reported as an unclassified caller.
  // A probe spawned with an all-literal argv takes no runtime input, so there
  // is nothing to terminate: `spawnSync("ffprobe", ["-version"])` is a
  // capability check, not a file probe. Dropping those keeps them out of the
  // unclassified list without weakening it — an argv carrying a bare
  // identifier (a path) still has to be understood.
  //
  // Split into a linear scan plus a per-body check rather than one regex.
  // The obvious `(?:"[^"]*"\s*,?\s*)+` form nests a quantifier inside a
  // quantifier with an optional separator, so whitespace can be matched two
  // ways and it backtracks exponentially on a long non-matching argv — CodeQL
  // flagged it as js/redos, correctly.
  const code = stripComments(src);
  return CALLS_PROBE.test(withoutNoInputProbes(code));
}

const PROBE_SPAWN_HEAD =
  /(?:spawn|spawnSync|execFile\w*|exec)\s*\(\s*["'`]ff(?:probe|mpeg)["'`]\s*,\s*\[/g;
const CALLS_PROBE =
  /(?:spawn|spawnSync|execFile\w*|exec)\s*\(\s*[^,)]*(?:ffprobe|ffProbe|probeBin|probePath)/i;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every entry a string literal → no runtime path in this argv. */
function isLiteralOnlyArgv(body: string): boolean {
  const entries = body
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "");
  return entries.length > 0 && entries.every((e) => /^"[^"]*"$/.test(e));
}

/** Blank out `spawn("ffprobe", [ ...all literals... ])` occurrences. */
function withoutNoInputProbes(code: string): string {
  let out = "";
  let cursor = 0;
  PROBE_SPAWN_HEAD.lastIndex = 0;
  for (let m = PROBE_SPAWN_HEAD.exec(code); m !== null; m = PROBE_SPAWN_HEAD.exec(code)) {
    const bodyStart = m.index + m[0].length;
    const bodyEnd = code.indexOf("]", bodyStart);
    if (bodyEnd === -1) continue;
    if (!isLiteralOnlyArgv(code.slice(bodyStart, bodyEnd))) continue;
    out += code.slice(cursor, m.index);
    cursor = bodyEnd + 1;
    PROBE_SPAWN_HEAD.lastIndex = cursor;
  }
  return out + code.slice(cursor);
}

const SKIP_DIRS = new Set(["node_modules", "dist"]);

function isSourceFile(entry: string): boolean {
  if (!SOURCE_EXT.test(entry) || entry.endsWith(".d.ts")) return false;
  // This file documents the contract with example argvs, including a
  // deliberately misordered one. Scanning itself reports its own prose.
  if (entry === "ffprobeArgvContract.test.ts") return false;
  // Test files are swept too. A test that probes a rendered output is itself a
  // caller, and `dither.test.mjs` was one of the 17 broken sites.
  return true;
}

function discoverCallers(): { found: string[]; unclassified: string[]; shell: string[] } {
  const found: string[] = [];
  const unclassified: string[] = [];
  const shell: string[] = [];
  const classify = (abs: string): void => {
    const src = readFileSync(abs, "utf8");
    if (SHELL_EXT.test(abs) && /(?:^|[^\w-])ffprobe\s+-/m.test(src)) {
      shell.push(relative(REPO_ROOT, abs));
    }
    // Discovery is ARGV-shaped, not call-shaped. Matching on spawn/execFile
    // misses a dependency-injected runner — `runner("ffprobe", [...])` in
    // studio-server's mediaValidation.ts is exactly that, and a call-shaped
    // predicate skipped it silently. Anything that BUILDS a probe argv is a
    // caller, however it is invoked.
    if (argvTails(src).length > 0) found.push(relative(REPO_ROOT, abs));
    else if (mentionsProbe(src)) unclassified.push(relative(REPO_ROOT, abs));
  };
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const abs = join(dir, entry);
      // Per-entry, because a single unreadable one used to abort the whole
      // traversal: a dangling symlink under packages/studio/data/projects
      // threw ENOENT on stat, so every package sorting after `studio` —
      // including both studio-server callers — silently stopped being
      // checked. Skipping the entry keeps the sweep complete; the manifest
      // assertion is what caught the truncation.
      try {
        if (statSync(abs).isDirectory()) walk(abs);
        else if (isSourceFile(entry)) classify(abs);
      } catch {
        /* unreadable entry (dangling symlink, permissions) — not a caller */
      }
    }
  };
  for (const root of SWEEP_ROOTS) {
    const abs = join(REPO_ROOT, root);
    try {
      if (statSync(abs).isDirectory()) walk(abs);
    } catch {
      /* root absent in a partial checkout */
    }
  }
  return { found: found.sort(), unclassified: unclassified.sort(), shell: shell.sort() };
}

/**
 * Argv arrays that carry ffprobe/ffmpeg flags, with their trailing tokens.
 *
 * Deliberately shape-agnostic: it finds `[ ... ]` literals containing a known
 * probe flag and reports the last two entries, so `["-v","error",...spread,"--",p]`
 * and a multi-line `["-of","json","--",p]` are both covered.
 */
// ffPROBE-shaped only. ffmpeg takes its input via `-i` (already unambiguous,
// the flag consumes the next token) and its OUTPUT as the trailing positional,
// where `--` is not the convention — so matching those produced false
// positives on every encode call (`..., "-y", outputPath`).
const PROBE_ONLY_FLAG =
  /"-(?:of|print_format|show_entries|show_format|show_streams|select_streams|count_packets)"/;
/** `-y` (overwrite output) and `-i` (input flag) mark an ffmpeg argv. */
const FFMPEG_SHAPE = /"-(?:y|i)"/;
/**
 * A generic wrapper builds its flags from a spread — `["-v", "error",
 * ...argsWithoutInput, "--", filePath]` — so it carries no literal probe flag
 * of its own. That is the exact shape `engine/utils/ffprobe.ts` uses, and the
 * shape a probe-flag-only matcher silently skipped.
 */
const SPREAD_WRAPPER = /"-v"[\s\S]*\.\.\.[A-Za-z_$]/;

function argvTails(source: string): Array<{ snippet: string; tail: string[] }> {
  const tails: Array<{ snippet: string; tail: string[] }> = [];
  // Non-greedy array literal, tolerant of newlines and spreads.
  for (const m of source.matchAll(/\[((?:[^[\]]|\[[^\]]*\])*?)\]/gs)) {
    const body = m[1] ?? "";
    const isProbeArgv = PROBE_ONLY_FLAG.test(body) || SPREAD_WRAPPER.test(body);
    if (!isProbeArgv || FFMPEG_SHAPE.test(body)) continue;
    const parts = body
      .split(",")
      .map((p) => p.replace(/\/\/[^\n]*/g, "").trim())
      .filter((p) => p !== "");
    if (parts.length < 2) continue;
    tails.push({ snippet: m[0].replace(/\s+/g, " ").slice(0, 90), tail: parts.slice(-2) });
  }
  return tails;
}

describe("shell ffprobe invocations terminate their options", () => {
  const shellFiles = discoverCallers().shell;

  it("finds the shell callers", () => {
    // Guards the guard: `frame_strip.sh` and `render-and-composite.sh` both
    // shipped un-terminated while the JS-only sweep reported the class closed.
    expect(shellFiles.length).toBeGreaterThan(0);
  });

  it.each(shellFiles)("%s passes -- on every ffprobe command line", (relPath) => {
    const source = readFileSync(join(REPO_ROOT, relPath), "utf8");
    const offenders = source
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      // An invocation passes flags. `command -v ffprobe >/dev/null` is a PATH
      // check and `echo "ffmpeg/ffprobe not on PATH"` is a message; neither
      // takes an input, and both were reported before this narrowed.
      .filter(({ line }) => /(?:^|[^\w-])ffprobe\s+-/.test(line) && !line.startsWith("#"))
      .filter(({ line }) => !/\b(?:command\s+-v|which|type)\s+ffprobe/.test(line))
      .filter(({ line }) => !/\s--\s/.test(line))
      .map(({ line, number }) => `${number}: ${line.slice(0, 80)}`);

    expect(offenders, `${relPath}: ffprobe command lines missing "--"`).toEqual([]);
  });
});

describe("ffprobe argv contract", () => {
  const { found: callers, unclassified } = discoverCallers();

  it("still discovers every caller in the manifest", () => {
    const missing = MANIFEST.filter((f) => !callers.includes(f));
    expect(missing, "discovery regressed — these are no longer being checked").toEqual([]);
  });

  it("classifies every file that spawns ffprobe", () => {
    // A caller written in a shape the matcher does not recognise is checked by
    // nothing. Fail loudly and widen the matcher rather than skip it.
    expect(unclassified, "spawns ffprobe but built no argv this test understands").toEqual([]);
  });

  it.each(callers)("%s terminates options immediately before the input", (relPath) => {
    const source = readFileSync(join(REPO_ROOT, relPath), "utf8");
    const offenders = argvTails(source)
      .filter(({ tail }) => {
        const [penultimate, last] = tail;
        // A trailing string literal is a flag/value, not a path — those argv
        // arrays do not take an input here.
        if (last === undefined || /^["'`]/.test(last)) return false;
        return penultimate !== '"--"';
      })
      .map(({ snippet, tail }) => `${tail.join(" , ")}  in  ${snippet}`);

    expect(offenders, `${relPath}: "--" must be immediately before the input`).toEqual([]);
  });

  // MISORDERING, not just removal. `["-of","json",path,"--"]` contains the
  // terminator but does nothing, and a presence-only check passes it.
  it.each(callers)("%s never places the terminator after the input", (relPath) => {
    const source = readFileSync(join(REPO_ROOT, relPath), "utf8");
    const misordered = argvTails(source)
      .filter(({ tail }) => tail[1] === '"--"')
      .map(({ snippet }) => snippet);
    expect(misordered, `${relPath}: "--" must precede the input, not follow it`).toEqual([]);
  });

  // audioPadTrim's runFfprobeJson takes a pre-built argv, so it cannot add the
  // terminator itself and instead asserts one is present. Presence is weaker
  // than position — pin that the callers put it immediately before the path.
  it("audioPadTrim's pre-built argv puts the terminator immediately before the input", () => {
    const src = readFileSync(
      join(REPO_ROOT, "packages/producer/src/services/render/audioPadTrim.ts"),
      "utf8",
    );
    const probeArgvs = argvTails(src);
    expect(probeArgvs.length).toBeGreaterThan(0);
    for (const { tail, snippet } of probeArgvs) {
      expect(tail[0], `terminator not penultimate in ${snippet}`).toBe('"--"');
    }
  });
});
