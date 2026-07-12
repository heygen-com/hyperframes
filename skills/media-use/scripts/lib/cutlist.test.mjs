import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compileCutList } from "./cutlist.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "transcript-cut.mjs");

test("explicit --remove ranges invert to kept segments", () => {
  const transcript = [
    word("w0", "alpha", 0, 1),
    word("w1", "beta", 1.2, 2),
    word("w2", "gamma", 2.2, 5),
  ];

  assert.deepEqual(compileCutList(transcript, { remove: "1-2.5" }), [
    { start: 0, end: 1 },
    { start: 2.5, end: 5 },
  ]);
});

test("--remove-words resolves inclusive word-index ranges to time ranges", () => {
  const transcript = [
    word("w0", "zero", 0, 0.5),
    word("w1", "one", 0.6, 1),
    word("w2", "two", 1.1, 1.5),
    word("w3", "three", 2, 3),
  ];

  assert.deepEqual(compileCutList(transcript, { removeWords: "1-2" }), [
    { start: 0, end: 0.6 },
    { start: 1.5, end: 3 },
  ]);
});

test("--remove-fillers drops case-insensitive matching words", () => {
  const transcript = [
    word("w0", "Hello", 0, 0.5),
    word("w1", "Um", 0.5, 0.7),
    word("w2", "world", 0.8, 1.2),
    word("w3", "LIKE", 1.3, 1.5),
    word("w4", "done", 1.6, 2),
  ];

  assert.deepEqual(compileCutList(transcript, { removeFillers: "um,like" }), [
    { start: 0, end: 0.5 },
    { start: 0.7, end: 1.3 },
    { start: 1.5, end: 2 },
  ]);
});

test("--cut-silence removes only the center of long inter-word gaps", () => {
  const transcript = [word("w0", "a", 0, 0.5), word("w1", "b", 2, 2.5), word("w2", "c", 2.7, 3)];

  assert.deepEqual(compileCutList(transcript, { cutSilence: 0.8 }), [
    { start: 0, end: 0.65 },
    { start: 1.85, end: 3 },
  ]);
});

test("overlapping removal sources merge before inversion", () => {
  const transcript = [
    word("w0", "start", 0, 0.5),
    word("w1", "um", 0.9, 1.1),
    word("w2", "middle", 2.5, 2.8),
    word("w3", "more", 3.1, 3.4),
    word("w4", "end", 5.5, 6),
  ];

  assert.deepEqual(
    compileCutList(transcript, {
      remove: "1-2.7",
      removeWords: "2-3",
      removeFillers: "um",
    }),
    [
      { start: 0, end: 0.9 },
      { start: 3.4, end: 6 },
    ],
  );
});

test("kept slivers shorter than 0.2s are dropped", () => {
  const transcript = [word("w0", "start", 0, 0.5), word("w1", "end", 2.5, 3)];

  assert.deepEqual(compileCutList(transcript, { remove: "0.1-2.95" }), []);
});

test("--keep is inverse mode and coalesces direct kept ranges", () => {
  const transcript = [word("w0", "start", 0, 0.5), word("w1", "end", 4.5, 5)];

  assert.deepEqual(compileCutList(transcript, { keep: "3-4,1-2,1.5-2.5,4.1-4.2" }), [
    { start: 1, end: 2.5 },
    { start: 3, end: 4 },
  ]);
});

test("--plan on a fixture transcript prints the exact segment JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "media-use-cutlist-"));
  try {
    const transcriptPath = join(dir, "fixture.json");
    writeFileSync(
      transcriptPath,
      JSON.stringify([
        word("w0", "hello", 0, 0.4),
        word("w1", "um", 0.5, 0.65),
        word("w2", "there", 0.7, 1),
        word("w3", "pause", 2.2, 2.5),
        word("w4", "end", 2.7, 3.2),
      ]),
    );

    const out = execFileSync(
      process.execPath,
      [
        SCRIPT,
        "--input",
        "ignored.mp4",
        "--transcript",
        transcriptPath,
        "--remove",
        "0.9-1.2",
        "--remove-fillers",
        "um",
        "--cut-silence",
        "0.8",
        "--plan",
      ],
      { encoding: "utf8" },
    );

    assert.deepEqual(JSON.parse(out), [
      { start: 0, end: 0.5 },
      { start: 0.65, end: 0.9 },
      { start: 2.05, end: 3.2 },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function word(id, text, start, end) {
  return { id, text, start, end };
}
