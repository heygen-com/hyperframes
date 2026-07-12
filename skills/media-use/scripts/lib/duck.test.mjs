import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { duckKeyframes, speechSpans } from "./duck.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "audio-duck.mjs");

test("speechSpans bridges gaps smaller than mergeGap", () => {
  const meta = {
    words: [word("w0", "one", 0, 0.5), word("w1", "two", 0.8, 1), word("w2", "three", 2, 2.2)],
  };

  assert.deepEqual(speechSpans(meta, { mergeGap: 0.4 }), [
    { start: 0, end: 1 },
    { start: 2, end: 2.2 },
  ]);
});

test("speechSpans refuses multi-line meta without placement (file-relative times)", () => {
  const meta = {
    voices: [
      { id: "a", words: [word("w0", "one", 0, 1)] },
      { id: "b", words: [word("w1", "two", 0, 1)] },
    ],
  };
  assert.throws(() => speechSpans(meta, { mergeGap: 0.2 }), /--sequential or --offsets/);
});

test("speechSpans sequential stacks lines by duration plus gap", () => {
  const meta = {
    voices: [
      { id: "a", duration_s: 2, words: [word("w0", "one", 0.1, 1.9)] },
      { id: "b", duration_s: 1, words: [word("w1", "two", 0.1, 0.9)] },
    ],
  };
  assert.deepEqual(speechSpans(meta, { mergeGap: 0.2, sequential: true, gap: 0.5 }), [
    { start: 0.1, end: 1.9 },
    { start: 2.6, end: 3.4 },
  ]);
});

test("speechSpans explicit offsets place each line at composition time", () => {
  const meta = {
    voices: [
      { id: "a", words: [word("w0", "one", 0, 1)] },
      { id: "b", words: [word("w1", "two", 0, 1)] },
    ],
  };
  assert.deepEqual(speechSpans(meta, { mergeGap: 0.2, offsets: { a: 0, b: 4 } }), [
    { start: 0, end: 1 },
    { start: 4, end: 5 },
  ]);
  assert.throws(() => speechSpans(meta, { offsets: { a: 0 } }), /missing voice "b"/);
});

test("speechSpans returns empty spans for empty input", () => {
  assert.deepEqual(speechSpans({ voices: [] }, { mergeGap: 0.6 }), []);
});

test("duckKeyframes shapes attack and release from base volume", () => {
  assert.deepEqual(
    duckKeyframes([{ start: 3, end: 5 }], {
      duck: 0.25,
      attack: 0.15,
      release: 0.4,
      baseVolume: 0.6,
    }),
    [
      { time: 3, volume: 0.15, duration: 0.15 },
      { time: 5, volume: 0.6, duration: 0.4 },
    ],
  );
});

test("--json spans match --merge-gap semantics exactly", () => {
  const dir = mkdtempSync(join(tmpdir(), "media-use-duck-"));
  try {
    const metaPath = join(dir, "audio_meta.json");
    writeFileSync(
      metaPath,
      JSON.stringify({
        voices: [
          {
            id: "narration",
            words: [
              word("w0", "one", 0, 0.4),
              word("w1", "two", 0.9, 1.2),
              word("w2", "three", 1.8, 2.1),
            ],
          },
        ],
      }),
    );

    const out = execFileSync(
      process.execPath,
      [SCRIPT, "--meta", metaPath, "--target", "#bgm", "--merge-gap", "0.6", "--json"],
      { encoding: "utf8" },
    );

    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.spans, [
      { start: 0, end: 1.2 },
      { start: 1.8, end: 2.1 },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function word(id, text, start, end) {
  return { id, text, start, end };
}
