import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./transitions.mjs", import.meta.url).pathname;

function write(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

test("inject extends a documented frame root that omits data-duration", (t) => {
  const project = mkdtempSync(join(tmpdir(), "faceless-transitions-"));
  t.after(() => rmSync(project, { force: true, recursive: true }));

  write(
    join(project, "STORYBOARD.md"),
    `---
format: 1920x1080
---

## Frame 1 — First

- duration: 2s
- transition_in: cut
- status: animated
- src: compositions/frames/01-a.html

## Frame 2 — Second

- duration: 2s
- transition_in: crossfade
- status: animated
- src: compositions/frames/02-b.html
`,
  );
  write(
    join(project, "index.html"),
    `<!doctype html><html><body>
<div id="root" data-composition-id="main" data-duration="4"></div>
<div id="el-01-a" data-start="0" data-duration="2" data-track-index="0"></div>
<div id="el-02-b" data-start="2" data-duration="2" data-track-index="0"></div>
<script>window.__timelines={}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`,
  );
  write(
    join(project, "compositions/frames/01-a.html"),
    `<template><div id="root" data-composition-id="01-a"><div class="clip" data-start="0" data-duration="2" data-track-index="0">first</div></div></template>`,
  );
  write(
    join(project, "compositions/frames/02-b.html"),
    `<template><div id="root" data-composition-id="02-b"><div class="clip" data-start="0" data-duration="2" data-track-index="0">second</div></div></template>`,
  );

  const result = spawnSync(
    process.execPath,
    [script, "inject", "--storyboard", join(project, "STORYBOARD.md"), "--hyperframes", project],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const outgoing = readFileSync(join(project, "compositions/frames/01-a.html"), "utf8");
  assert.match(outgoing, /data-composition-id="01-a" data-duration="2.5"/);
  assert.match(outgoing, /class="clip"[^>]*data-duration="2.5"/);
});
