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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const SKILLS_DIR = dirname(fileURLToPath(import.meta.url));

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
 * Every `open(...)` / `read_text(...)` / `write_text(...)` call in the source, paired with
 * its argument text. Scanning to the balanced close paren beats a regex here: a regex has
 * to cap nesting depth, and a call it fails to match is a call it silently exempts — the
 * opposite of what a guard is for.
 */
function fileIoCalls(source) {
  const calls = [];
  const opener = /\b(open|read_text|write_text)\(/g;
  for (let m = opener.exec(source); m; m = opener.exec(source)) {
    const end = closingParen(source, m.index + m[0].length - 1);
    if (end < 0) continue; // unbalanced source; nothing to assert
    calls.push({
      name: m[1],
      args: source.slice(m.index + m[0].length, end),
      text: source.slice(m.index, end + 1),
    });
  }
  return calls;
}

/**
 * Index of the `)` closing the `(` at `start`, or -1 if the source is unbalanced.
 * Counting with arithmetic rather than branches keeps this at the size it deserves:
 * `start` is the opening paren, so depth returns to 0 exactly at its partner.
 */
function closingParen(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    depth += Number(source[i] === "(") - Number(source[i] === ")");
    if (depth === 0) return i;
  }
  return -1;
}

// A binary mode is a WHOLE argument (comma-delimited) made only of mode characters, one of
// which is `b`. Both halves matter. Testing the whole call text for any quoted "b" let a
// payload key spell the check away — `write_text(json.dumps({"bpm": 120}))` exempted
// itself, and "bpm"/"bars" are literally analyze-beatgrid's own keys. Restricting to mode
// characters rules that out without having to split arguments: "bpm" holds `p` and `m`,
// which no mode does.
const BINARY_MODE = /(^|,)\s*(["'])[rwxa+t]*b[rwxa+t]*\2\s*(,|$)/;

/** True when no encoding applies. `Path.read_text`/`write_text` have no mode: always text. */
function isBinary(call) {
  return call.name === "open" && BINARY_MODE.test(call.args);
}
