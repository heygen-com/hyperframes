import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "./concurrency.mjs";

// Regression: audio.mjs used a bare Promise.all(lines.map(synthLine)) to
// synthesize every TTS line at once, spawning one Kokoro/whisper model load
// per line concurrently. Two independent reports of this overwhelming a
// machine (OOM, and cold-start contention causing spurious failures).
// mapWithConcurrency is the extracted cap; test it in isolation since
// audio.mjs itself is a script (runs CLI/exit side effects on import).
test("processes every item and preserves input order regardless of completion order", async () => {
  const order = [5, 1, 3, 2, 4];
  const results = await mapWithConcurrency(order, 2, async (n) => {
    await new Promise((r) => setTimeout(r, n));
    return n * 10;
  });
  assert.deepEqual(results, [50, 10, 30, 20, 40]);
});

test("never runs more than `limit` at once", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);
  await mapWithConcurrency(items, 3, async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
  });
  assert.equal(maxInFlight, 3);
});

test("limit larger than the item count runs everything without hanging", async () => {
  const results = await mapWithConcurrency([1, 2], 10, async (n) => n * 2);
  assert.deepEqual(results, [2, 4]);
});

test("empty input resolves to an empty array", async () => {
  const results = await mapWithConcurrency([], 4, async (n) => n);
  assert.deepEqual(results, []);
});
