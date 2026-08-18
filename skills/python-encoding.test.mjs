// Skill Python scripts run on the user's own machine, Windows included. There, Python
// sizes stdio and text-mode file IO to the ANSI code page (cp1252) rather than UTF-8:
//
//   * printing a glyph cp1252 has no slot for (Δ, →) raises UnicodeEncodeError, which
//     is how `analyze-beatgrid.py --print` died on every Windows run;
//   * reading a UTF-8 source raises UnicodeDecodeError, or worse, decodes each byte to
//     the wrong character and the script silently keys off it.
//
// So every skill Python script pins UTF-8 explicitly. This test is the guard: the class
// of bug returns the moment one file IO call drops `encoding=` or a new script ships
// without the stdio block. Repo-internal dev scripts (packages/**) are out of scope —
// they only ever run on CI and maintainer machines.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const SKILLS_DIR = resolve(fileURLToPath(new URL("./", import.meta.url)));

function pythonScripts(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) found.push(...pythonScripts(abs));
    else if (entry.endsWith(".py")) found.push(abs);
  }
  return found;
}

const scripts = pythonScripts(SKILLS_DIR).map((abs) => ({
  rel: relative(SKILLS_DIR, abs),
  source: readFileSync(abs, "utf8"),
}));

describe("skill Python scripts pin UTF-8", () => {
  it("finds the scripts (guards against a layout change silently emptying this suite)", () => {
    assert.ok(scripts.length >= 5, `expected >=5 skill Python scripts, found ${scripts.length}`);
  });

  for (const { rel, source } of scripts) {
    it(`${rel} reconfigures stdio to UTF-8, preserving the errors handler`, () => {
      // `errors=` is not optional. reconfigure() resets the handler to "strict", and
      // CPython gives stderr "backslashreplace" on purpose so the diagnostic path can
      // never itself raise — dropping it moves the crash onto error reporting.
      assert.match(
        source,
        /reconfigure\(encoding="utf-8", errors=_stream\.errors\)/,
        'add the `for _stream in (sys.stdout, sys.stderr): ... reconfigure(encoding="utf-8", errors=_stream.errors)` block',
      );
    });

    it(`${rel} passes encoding= to every text-mode file IO call`, () => {
      const offenders = fileIoCalls(source)
        .filter((call) => !isBinary(call))
        .filter((call) => !/\bencoding\s*=/.test(call.text))
        .map((call) => call.text);
      assert.deepEqual(offenders, [], `text IO without encoding= in ${rel}`);
    });
  }
});

/**
 * Every `open(...)` / `read_text(...)` / `write_text(...)` call in the source, matched by
 * scanning to the balanced close paren rather than by regex. A regex has to cap nesting
 * depth, and a call it fails to match is a call it silently exempts — the opposite of what
 * a guard is for.
 */
function fileIoCalls(source) {
  const calls = [];
  const opener = /\b(open|read_text|write_text)\(/g;
  for (let m = opener.exec(source); m; m = opener.exec(source)) {
    const argsStart = m.index + m[0].length;
    let depth = 1;
    let i = argsStart;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
    }
    if (depth !== 0) continue; // unbalanced source; nothing to assert
    calls.push({
      name: m[1],
      args: source.slice(argsStart, i - 1),
      text: source.slice(m.index, i),
    });
  }
  return calls;
}

/**
 * True for a binary-mode call, where no encoding applies. The mode is `open`'s SECOND
 * POSITIONAL argument and nothing else — testing the whole call text for a quoted "b"
 * let any payload key spell the check away (`write_text(json.dumps({"bpm": 120}))`
 * exempted itself, and "bpm"/"bars" are literally analyze-beatgrid's own keys).
 */
function isBinary(call) {
  if (call.name !== "open") return false; // Path.read_text/write_text are always text
  const mode = splitTopLevelArgs(call.args)[1];
  return mode !== undefined && /^(["'])[^"']*b[^"']*\1$/.test(mode.trim());
}

function splitTopLevelArgs(args) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (quote) {
      if (ch === quote && args[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts;
}
