import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { padFrameInternalDuration } from "./pad-frame-duration.mjs";

// Regression: an outgoing transition pads the index.html WRAPPER's
// data-duration to cover the transition tail, but the frame's own internal
// file kept its shorter content-only duration, so the render engine
// clip-gated the sub-composition's visible content at the shorter value —
// content vanished abruptly instead of fading through the wrapper's
// extended fade-out tween. A user diagnosed and verified this fix
// themselves: pad the frame's own #root/clip data-duration to match.
test("padFrameInternalDuration pads the matching frame's own data-duration", () => {
  const dir = mkdtempSync(join(tmpdir(), "transitions-pad-"));
  const framesDir = join(dir, "compositions", "frames");
  mkdirSync(framesDir, { recursive: true });
  const frameSrc = "compositions/frames/scene-1.html";
  const framePath = join(dir, frameSrc);
  writeFileSync(
    framePath,
    `<template>
  <div
    id="root"
    data-composition-id="scene-1"
    data-width="1920"
    data-height="1080"
    data-duration="4.2"
  ></div>
</template>`,
  );

  try {
    padFrameInternalDuration(dir, frameSrc, "scene-1", 4.7);
    const updated = readFileSync(framePath, "utf8");
    assert.match(updated, /data-duration="4\.7"/);
    assert.doesNotMatch(updated, /data-duration="4\.2"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("padFrameInternalDuration only touches the tag matching the given frame id", () => {
  const dir = mkdtempSync(join(tmpdir(), "transitions-pad-scope-"));
  const framesDir = join(dir, "compositions", "frames");
  mkdirSync(framesDir, { recursive: true });
  const frameSrc = "compositions/frames/scene-2.html";
  const framePath = join(dir, frameSrc);
  const original = `<template>
  <div id="root" data-composition-id="scene-2" data-duration="3.0">
    <div data-composition-id="unrelated-child" data-duration="1.0"></div>
  </div>
</template>`;
  writeFileSync(framePath, original);

  try {
    padFrameInternalDuration(dir, frameSrc, "scene-2", 3.5);
    const updated = readFileSync(framePath, "utf8");
    assert.match(updated, /data-composition-id="scene-2" data-duration="3\.5"/);
    assert.match(updated, /data-composition-id="unrelated-child" data-duration="1\.0"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("padFrameInternalDuration is a no-op when the frame file does not exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "transitions-pad-missing-"));
  try {
    assert.doesNotThrow(() =>
      padFrameInternalDuration(dir, "compositions/frames/missing.html", "missing", 5),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
