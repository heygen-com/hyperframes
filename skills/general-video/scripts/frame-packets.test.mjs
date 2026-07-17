import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildFramePackets } from "./frame-packets.mjs";

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

test("packets inline the blueprint body and the Scene-cited rule recipes", () => {
  const project = mkdtempSync(join(tmpdir(), "gv-packets-"));
  write(join(project, "frame.md"), "# tokens\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Hook\n\n- duration: 3s\n- src: compositions/01-hook.html\n- blueprint: dataviz-countup\n- scene: hero stat punches in\n\nScene 1 (0.0–1.5s): the stat enters via spring-pop-entrance, then counting-dynamic-scale runs the tally.\n\n## Frame 2 — Freeform\n\n- duration: 4s\n- src: compositions/02-freeform.html\n- blueprint: compose\n\nScene 1 (0.0–4.0s): a quiet hold, no named motion.\n`,
  );

  const result = buildFramePackets({ projectDir: project });
  assert.equal(result.length, 2);

  const hook = readFileSync(result[0].path, "utf8");
  assert.match(hook, /## Selected blueprint: dataviz-countup/);
  assert.match(hook, /## Selected motion rule: spring-pop-entrance/);
  assert.match(hook, /## Selected motion rule: counting-dynamic-scale/);
  assert.match(hook, /RULES_DIR: /);

  const freeform = readFileSync(result[1].path, "utf8");
  assert.doesNotMatch(freeform, /## Selected blueprint/);
  assert.doesNotMatch(freeform, /## Selected motion rule/);
});

test("design truth resolves frame.md → design.md → DESIGN.md", () => {
  const project = mkdtempSync(join(tmpdir(), "gv-design-"));
  write(join(project, "design.md"), "# design truth\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Hook\n\n- duration: 3s\n- src: compositions/01-hook.html\n`,
  );

  const result = buildFramePackets({ projectDir: project });
  const packet = readFileSync(result[0].path, "utf8");
  assert.match(packet, /Design truth: .*design\.md/);
  assert.doesNotMatch(packet, /Design truth: .*frame\.md/);
});

test("_role.md is the core contract + this workflow's delta, verbatim", () => {
  const project = mkdtempSync(join(tmpdir(), "gv-role-"));
  write(join(project, "frame.md"), "# tokens\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Hook\n\n- duration: 3s\n- src: compositions/01-hook.html\n`,
  );

  buildFramePackets({ projectDir: project });
  const rolePath = join(project, ".hyperframes", "frame-packets", "_role.md");
  assert.ok(existsSync(rolePath));
  const role = readFileSync(rolePath, "utf8");
  assert.match(role, /# Frame worker — core contract/);
  assert.match(role, /# Frame worker — general-video delta/);
});

test("packet validation is atomic and leaves no partial output on overflow", () => {
  const project = mkdtempSync(join(tmpdir(), "gv-atomic-"));
  const outDir = join(project, ".hyperframes", "frame-packets");
  write(join(project, "frame.md"), "# tokens\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Big\n\n- duration: 3s\n- src: compositions/01-big.html\n\n${"padding line\n".repeat(300)}`,
  );

  assert.throws(
    () => buildFramePackets({ projectDir: project, outDir, maxPacketBytes: 2_000 }),
    /limit 2000/,
  );
  assert.equal(existsSync(outDir), false);
});
