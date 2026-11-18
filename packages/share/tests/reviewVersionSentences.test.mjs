import assert from "node:assert/strict";
import { test } from "node:test";
import { ReviewFailed } from "../src/reviewClient.mjs";
import { versionSentence } from "../src/reviewVersionSentences.mjs";

test("the hourly version cap says how long to wait instead of telling the person to try again now", () => {
  assert.equal(
    versionSentence(new ReviewFailed(429, "export_hourly_limit", undefined, 25 * 60_000)),
    "You've added the most versions for this hour. Try again in 25 minutes.",
  );
});

test("each cap falls back to its own window when the server sends no Retry-After", () => {
  assert.equal(
    versionSentence(new ReviewFailed(429, "export_hourly_limit")),
    "You've added the most versions for this hour. Try again in an hour.",
  );
  assert.equal(
    versionSentence(new ReviewFailed(429, "export_daily_limit")),
    "You've added the most versions for today. Try again tomorrow.",
  );
});

test("the daily version cap rounds a long wait to hours", () => {
  assert.equal(
    versionSentence(new ReviewFailed(429, "export_daily_limit", undefined, 2 * 60 * 60_000)),
    "You've added the most versions for today. Try again in about 2 hours.",
  );
});
