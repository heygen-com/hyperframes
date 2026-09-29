import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflowScripts = [
  ["product-launch-video", new URL("./transitions.mjs", import.meta.url).pathname],
  ["pr-to-video", new URL("../../pr-to-video/scripts/transitions.mjs", import.meta.url).pathname],
];

function runInject(script, rootId) {
  const project = mkdtempSync(join(tmpdir(), "hf-transition-root-"));
  const framesDir = join(project, "compositions", "frames");
  mkdirSync(framesDir, { recursive: true });
  writeFileSync(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — First\n\n- duration: 3s\n- transition_in: cut\n- src: compositions/frames/frame-01.html\n\n## Frame 2 — Second\n\n- duration: 3s\n- transition_in: crossfade 0.5s\n- src: compositions/frames/frame-02.html\n`,
  );
  writeFileSync(
    join(framesDir, "frame-01.html"),
    `<div data-composition-id="${rootId}" data-width="1920" data-height="1080"><div class="clip" data-start="0" data-duration="3"></div></div>`,
  );
  writeFileSync(
    join(framesDir, "frame-02.html"),
    '<div data-composition-id="frame-02" data-duration="3"></div>',
  );
  writeFileSync(
    join(project, "index.html"),
    `<div data-composition-id="main" data-duration="6">
      <div id="el-frame-01" data-start="0" data-duration="3" data-track-index="0"></div>
      <div id="el-frame-02" data-start="3" data-duration="3" data-track-index="0"></div>
    </div><script>window.__timelines = {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>`,
  );
  const result = spawnSync(
    process.execPath,
    [script, "inject", "--storyboard", join(project, "STORYBOARD.md"), "--hyperframes", project],
    { encoding: "utf8" },
  );
  return {
    project,
    result,
    frameHtml: () => readFileSync(join(framesDir, "frame-01.html"), "utf8"),
  };
}

for (const [workflow, script] of workflowScripts) {
  test(`${workflow} inserts duration on a valid durationless frame root`, () => {
    const fixture = runInject(script, "frame-01");
    try {
      assert.equal(fixture.result.status, 0, fixture.result.stderr);
      assert.match(fixture.frameHtml(), /data-composition-id="frame-01"[^>]*data-duration="3\.5"/);
    } finally {
      rmSync(fixture.project, { recursive: true, force: true });
    }
  });

  test(`${workflow} still rejects a genuinely mismatched frame root`, () => {
    const fixture = runInject(script, "wrong-root");
    try {
      assert.notEqual(fixture.result.status, 0);
      assert.match(fixture.result.stderr, /has no data-composition-id="frame-01" root/);
    } finally {
      rmSync(fixture.project, { recursive: true, force: true });
    }
  });
}
