import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { duckKeyframes, duckLane, speechSpans } from "./duck.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Keep the skill-owned wrapper path under test until the compatibility layer
// is removed in a later release.
const SCRIPT = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "..",
  "skills",
  "media-use",
  "scripts",
  "audio-duck.mjs",
);

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

test("speechSpans offsets retain voice IDs across empty transcripts", () => {
  const meta = {
    voices: [
      { id: "silent", duration_s: 2, words: [] },
      { id: "narration", duration_s: 1, words: [word("w0", "hello", 0.1, 0.9)] },
    ],
  };
  const expected = [{ start: 4.1, end: 4.9 }];
  assert.deepEqual(speechSpans(meta, { offsets: { silent: 0, narration: 4 } }), expected);
  assert.deepEqual(speechSpans(meta, { offsets: { narration: 4 } }), expected);
  assert.throws(() => speechSpans(meta, { offsets: { silent: 0 } }), /missing voice "narration"/);
});

test("speechSpans sequential counts empty line durations and gaps", () => {
  const meta = {
    voices: [
      { id: "intro", duration_s: 2, words: [] },
      { id: "first", duration_s: 1, words: [word("w0", "hello", 0.1, 0.9)] },
      { id: "pause", duration_s: 3, words: [] },
      { id: "last", duration_s: 1, words: [word("w1", "goodbye", 0.1, 0.9)] },
    ],
  };
  assert.deepEqual(speechSpans(meta, { sequential: true, gap: 0.5 }), [
    { start: 2.6, end: 3.4 },
    { start: 7.6, end: 8.4 },
  ]);
});

test("speechSpans offsets without IDs retain original voice indices", () => {
  const meta = {
    voices: [{ duration_s: 2 }, { duration_s: 1, words: [word("w0", "hello", 0.1, 0.9)] }],
  };
  assert.deepEqual(speechSpans(meta, { offsets: { 1: 4 } }), [{ start: 4.1, end: 4.9 }]);
});

test("speechSpans keeps normalized-empty transcripts aligned with their voices", () => {
  const meta = {
    voices: [
      { id: "untimed", duration_s: 2, words: [{ text: "hello" }] },
      { id: "narration", duration_s: 1, words: [word("w0", "hello", 0.1, 0.9)] },
    ],
  };
  assert.deepEqual(speechSpans(meta, { sequential: true }), [{ start: 2.1, end: 2.9 }]);
});

test("speechSpans does not require placement for transcripts without speech", () => {
  const meta = {
    voices: [
      { id: "a", duration_s: 2, words: [] },
      { id: "b", duration_s: 1 },
    ],
  };
  assert.deepEqual(speechSpans(meta), []);
  assert.deepEqual(speechSpans(meta, { offsets: {} }), []);
  assert.deepEqual(speechSpans(meta, { sequential: true }), []);
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

test("duckLane turns composition-time keyframes into clip-local ramps", () => {
  const keyframes = [
    { time: 3, volume: 0.15, duration: 0.15 },
    { time: 5, volume: 0.6, duration: 0.4 },
  ];
  assert.deepEqual(duckLane(keyframes, { clipStart: 1, baseVolume: 0.6 }), {
    version: 1,
    lanes: [
      {
        target: "volume",
        points: [
          { t: 0, v: 0.6 },
          { t: 2, v: 0.6 },
          { t: 2.15, v: 0.15 },
          { t: 4, v: 0.15 },
          { t: 4.4, v: 0.6 },
        ],
      },
    ],
  });
});

for (const [name, clipStart, expected] of [
  [
    "before the attack",
    0.5,
    [
      { t: 0, v: 0.6 },
      { t: 0.5, v: 0.6 },
      { t: 0.65, v: 0.15 },
      { t: 2.5, v: 0.15 },
      { t: 2.9, v: 0.6 },
    ],
  ],
  [
    "during the attack",
    1.075,
    [
      { t: 0, v: 0.375 },
      { t: 0.075, v: 0.15 },
      { t: 1.925, v: 0.15 },
      { t: 2.325, v: 0.6 },
    ],
  ],
  [
    "during speech",
    2,
    [
      { t: 0, v: 0.15 },
      { t: 1, v: 0.15 },
      { t: 1.4, v: 0.6 },
    ],
  ],
  [
    "at the release",
    3,
    [
      { t: 0, v: 0.15 },
      { t: 0.4, v: 0.6 },
    ],
  ],
  [
    "during the release",
    3.2,
    [
      { t: 0, v: 0.375 },
      { t: 0.2, v: 0.6 },
    ],
  ],
  ["after narration", 4, [{ t: 0, v: 0.6 }]],
]) {
  test(`duckLane preserves composition-time gain when music starts ${name}`, () => {
    const keyframes = duckKeyframes([{ start: 1, end: 3 }], { baseVolume: 0.6 });
    const points = duckLane(keyframes, { clipStart, baseVolume: 0.6 }).lanes[0].points;

    assert.equal(points.length, expected.length);
    for (let i = 0; i < points.length; i++) {
      assert.equal(points[i].t, expected[i].t);
      assert.ok(
        Math.abs(points[i].v - expected[i].v) < 1e-9,
        `gain at ${points[i].t}s: expected ${expected[i].v}, received ${points[i].v}`,
      );
    }
  });
}

test("duckLane discards earlier narration and retains the next speech span", () => {
  const keyframes = duckKeyframes([
    { start: 1, end: 2 },
    { start: 5, end: 6 },
  ]);

  assert.deepEqual(duckLane(keyframes, { clipStart: 3 }).lanes[0].points, [
    { t: 0, v: 1 },
    { t: 2, v: 1 },
    { t: 2.15, v: 0.25 },
    { t: 3, v: 0.25 },
    { t: 3.4, v: 1 },
  ]);
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

for (const [placement, flags, expected] of [
  ["sequential", ["--sequential", "--gap", "0.5"], [{ start: 2.6, end: 3.4 }]],
  ["offsets", ["--offsets", "narration=4"], [{ start: 4.1, end: 4.9 }]],
]) {
  test(`audio-duck --json preserves empty voice placement with ${placement}`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "media-use-duck-empty-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const metaPath = join(dir, "audio_meta.json");
    writeFileSync(
      metaPath,
      JSON.stringify({
        voices: [
          { id: "silent", duration_s: 2, words: [] },
          { id: "narration", duration_s: 1, words: [word("w0", "hello", 0.1, 0.9)] },
        ],
      }),
    );
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [SCRIPT, "--meta", metaPath, "--target", "#bgm", ...flags, "--json"],
        { encoding: "utf8" },
      ),
    );
    assert.deepEqual(result.spans, expected);
    assert.equal(result.keyframes[0].time, expected[0].start);
    assert.equal(result.lane.lanes[0].points[1].t, expected[0].start);
  });
}

function word(id, text, start, end) {
  return { id, text, start, end };
}
