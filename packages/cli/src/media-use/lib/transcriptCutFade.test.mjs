import assert from "node:assert/strict";
import test from "node:test";
import { fadeFilterFor } from "./transcriptCutFade.mjs";

test("fades in only at the first segment's trailing splice", () => {
  assert.equal(fadeFilterFor(2, { fadeIn: false, fadeOut: true }), "afade=t=out:st=1.97:d=0.03");
});

test("fades both edges of a middle segment's two splices", () => {
  assert.equal(
    fadeFilterFor(2, { fadeIn: true, fadeOut: true }),
    "afade=t=in:st=0:d=0.03,afade=t=out:st=1.97:d=0.03",
  );
});

test("fades out only at the last segment's leading splice", () => {
  assert.equal(fadeFilterFor(2, { fadeIn: true, fadeOut: false }), "afade=t=in:st=0:d=0.03");
});

test("a single kept segment borders no splice at all", () => {
  assert.equal(fadeFilterFor(2, { fadeIn: false, fadeOut: false }), null);
});

test("still scales the ramp down on a short segment with both edges faded", () => {
  assert.equal(
    fadeFilterFor(0.08, { fadeIn: true, fadeOut: true }),
    "afade=t=in:st=0:d=0.02,afade=t=out:st=0.06:d=0.02",
  );
});

test("skips a degenerate segment even when a splice is requested", () => {
  assert.equal(fadeFilterFor(0.005, { fadeIn: true, fadeOut: true }), null);
});
