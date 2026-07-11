import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const skillDir = join(dirname(fileURLToPath(import.meta.url)), "..");

test("frame worker documents the approved video-hoist contract", () => {
  const instructions = readFileSync(join(skillDir, "sub-agents", "frame-worker.md"), "utf8");

  assert.match(instructions, /data-frame-video="approved"/);
  assert.match(instructions, /assemble-index\.mjs.*hoists it to the host root/i);
  assert.match(instructions, /Audio remains orchestrator-owned/i);
});

test("assemble hoists an approved timed frame video to the host root", () => {
  const project = mkdtempSync(join(tmpdir(), "hf-frame-video-"));
  mkdirSync(join(project, "compositions"));
  const framePath = join(project, "compositions", "frame-1.html");
  writeFileSync(
    join(project, "STORYBOARD.md"),
    "---\nformat: 16:9\n---\n\n## Frame 1 — Demo\n- status: built\n- duration: 2s\n- src: compositions/frame-1.html\n",
  );
  writeFileSync(
    framePath,
    `<html><body><div id="root" data-composition-id="frame-1" data-width="1920" data-height="1080"><video data-frame-video="approved" src="https://cdn.example/clip.mp4" poster="poster.png" preload="auto" muted playsinline loop style="background:url(https://evil.example/x)" nonce="unsafe" onerror="alert(1)" srcdoc="<script>alert(2)</script>" data-start="0.25" data-duration="1.5" data-track-index="7"></video></div><script>window.__timelines = {}; window.__timelines["frame-1"] = gsap.timeline();</script></body></html>`,
  );

  const result = spawnSync(
    process.execPath,
    [join(skillDir, "scripts", "assemble-index.mjs"), "--hyperframes", project],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const index = readFileSync(join(project, "index.html"), "utf8");
  const frame = readFileSync(framePath, "utf8");
  assert.match(index, /data-start="0\.25"/);
  assert.match(index, /data-duration="1\.5"/);
  assert.match(index, /data-track-index="1007"/);
  assert.match(index, /src="https:\/\/cdn\.example\/clip\.mp4"/);
  assert.match(index, /poster="poster\.png"/);
  assert.match(index, /preload="auto"/);
  assert.match(index, /\smuted(?:\s|>)/);
  assert.match(index, /\splaysinline(?:\s|>)/);
  assert.match(index, /\sloop(?:\s|>)/);
  assert.doesNotMatch(index, /onerror=/i);
  assert.doesNotMatch(index, /srcdoc=/i);
  assert.doesNotMatch(index, /nonce=/i);
  assert.doesNotMatch(index, /style=/i);
  assert.doesNotMatch(frame, /<video\b/i);
});

test("rejects an approved video with missing admission timing", () => {
  const project = mkdtempSync(join(tmpdir(), "hf-frame-video-missing-"));
  mkdirSync(join(project, "compositions"));
  writeFileSync(
    join(project, "STORYBOARD.md"),
    "---\nformat: 16:9\n---\n\n## Frame 1\n- status: built\n- duration: 2s\n- src: compositions/frame-1.html\n",
  );
  writeFileSync(
    join(project, "compositions", "frame-1.html"),
    `<html><body><div id="root" data-composition-id="frame-1" data-width="1920" data-height="1080"><video data-frame-video="approved" src="clip.mp4" data-duration="1" data-track-index="0"></video></div><script>window.__timelines = {}; window.__timelines["frame-1"] = gsap.timeline();</script></body></html>`,
  );
  const result = spawnSync(
    process.execPath,
    [join(skillDir, "scripts", "assemble-index.mjs"), "--hyperframes", project],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must declare quoted data-start/i);
});

test("does not hoist declarations hidden in comments or scripts", () => {
  const project = mkdtempSync(join(tmpdir(), "hf-frame-video-hidden-"));
  mkdirSync(join(project, "compositions"));
  writeFileSync(
    join(project, "STORYBOARD.md"),
    "---\nformat: 16:9\n---\n\n## Frame 1\n- status: built\n- duration: 2s\n- src: compositions/frame-1.html\n",
  );
  writeFileSync(
    join(project, "compositions", "frame-1.html"),
    `<html><body><div id="root" data-composition-id="frame-1" data-width="1920" data-height="1080"></div><script>window.__timelines = {}; window.__timelines["frame-1"] = gsap.timeline(); const s = '<video data-frame-video="approved" data-start="0" data-duration="1" data-track-index="1"></video>';</script><!-- <video data-frame-video="approved" data-start="0" data-duration="1" data-track-index="2"></video> --></body></html>`,
  );
  const result = spawnSync(
    process.execPath,
    [join(skillDir, "scripts", "assemble-index.mjs"), "--hyperframes", project],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(readFileSync(join(project, "index.html"), "utf8"), /data-track-index="1001"/);
});
