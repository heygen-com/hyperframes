import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  const framePath = join(project, "frame-1.html");
  writeFileSync(
    join(project, "STORYBOARD.md"),
    "---\nformat: 16:9\n---\n\n## Frame 1 — Demo\n- status: built\n- duration: 2s\n- src: frame-1.html\n",
  );
  writeFileSync(
    framePath,
    `<html><body><div id="root" data-composition-id="frame-1" data-width="1920" data-height="1080"><video data-frame-video="approved" src="https://cdn.example/clip.mp4" data-start="0.25" data-duration="1.5" data-track-index="7" muted></video></div></body></html>`,
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
  assert.doesNotMatch(frame, /<video\b/i);
});
