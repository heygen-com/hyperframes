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
  const project = mkdtempSync(join(tmpdir(), "plv-packets-"));
  write(join(project, "frame.md"), "# tokens\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Hook\n\n- duration: 3s\n- src: compositions/frames/01-hook.html\n- blueprint: dataviz-countup\n- scene: hero stat punches in\n\nScene 1 (0.0–1.5s): the stat enters via spring-pop-entrance, then counting-dynamic-scale runs the tally.\n\n## Frame 2 — Freeform\n\n- duration: 4s\n- src: compositions/frames/02-freeform.html\n- blueprint: compose\n\nScene 1 (0.0–4.0s): a quiet hold, no named motion.\n`,
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

test("_role.md is the core contract + this workflow's delta, verbatim", () => {
  const project = mkdtempSync(join(tmpdir(), "plv-role-"));
  write(join(project, "frame.md"), "# tokens\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Hook\n\n- duration: 3s\n- src: compositions/frames/01-hook.html\n`,
  );

  buildFramePackets({ projectDir: project });
  const rolePath = join(project, ".hyperframes", "frame-packets", "_role.md");
  assert.ok(existsSync(rolePath));
  const role = readFileSync(rolePath, "utf8");
  assert.match(role, /# Frame worker — core contract/);
  assert.match(role, /# Frame worker — product-launch delta/);
});

test("packet validation is atomic and leaves no partial output on overflow", () => {
  const project = mkdtempSync(join(tmpdir(), "plv-atomic-"));
  const outDir = join(project, ".hyperframes", "frame-packets");
  write(join(project, "frame.md"), "# tokens\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Big\n\n- duration: 3s\n- src: compositions/frames/01-big.html\n\n${"padding line\n".repeat(300)}`,
  );

  assert.throws(
    () => buildFramePackets({ projectDir: project, outDir, maxPacketBytes: 2_000 }),
    /limit 2000/,
  );
  assert.equal(existsSync(outDir), false);
});

// ── the blueprint qualifier ──────────────────────────────────────────────────
// Regression: visual-design.md documents `blueprint:` as the id plus a
// `(Reproduce)` / `(Adapt)` qualifier, and prints `dataviz-countup (Adapt)` as
// its worked example. The resolver used the raw field as the filename, so every
// qualified blueprint looked for a file that cannot exist and inlined "" —
// packets shipped without the document the frame was designed against, and the
// run still reported success. The cases above only ever used bare ids.

test("a qualified blueprint resolves to the same body as the bare id", () => {
  const project = mkdtempSync(join(tmpdir(), "plv-blueprint-qualified-"));
  write(join(project, "frame.md"), "# tokens\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Adapted\n\n- duration: 3s\n- src: compositions/frames/01-adapted.html\n- blueprint: device-surface-showcase (Adapt)\n\n## Frame 2 — Reproduced\n\n- duration: 3s\n- src: compositions/frames/02-reproduced.html\n- blueprint: device-surface-showcase (Reproduce)\n\n## Frame 3 — Bare\n\n- duration: 3s\n- src: compositions/frames/03-bare.html\n- blueprint: device-surface-showcase\n`,
  );

  const packets = buildFramePackets({ projectDir: project });
  const blueprintSections = packets.map((packet) => {
    const body = readFileSync(packet.path, "utf8");
    const start = body.indexOf("## Selected blueprint:");
    assert.notEqual(start, -1, `${packet.frameId} inlined no blueprint`);
    return body.slice(start);
  });

  assert.match(blueprintSections[0], /## Selected blueprint: device-surface-showcase\n/);
  // The qualifier is direction for the worker, not a different document: all
  // three frames must inline byte-identical blueprint bodies.
  assert.equal(new Set(blueprintSections).size, 1);
});

test("a qualified `compose` still selects no blueprint", () => {
  const project = mkdtempSync(join(tmpdir(), "plv-blueprint-compose-"));
  write(join(project, "frame.md"), "# tokens\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Freeform\n\n- duration: 3s\n- src: compositions/frames/01-freeform.html\n- blueprint: compose (Adapt)\n`,
  );

  const [packet] = buildFramePackets({ projectDir: project });

  assert.doesNotMatch(readFileSync(packet.path, "utf8"), /## Selected blueprint/);
});

test("a blueprint with no file fails the run instead of shipping an empty section", () => {
  const project = mkdtempSync(join(tmpdir(), "plv-blueprint-missing-"));
  const outDir = join(project, ".hyperframes", "frame-packets");
  write(join(project, "frame.md"), "# tokens\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Typo\n\n- duration: 3s\n- src: compositions/frames/01-typo.html\n- blueprint: device-surface-showcses\n`,
  );

  assert.throws(
    () => buildFramePackets({ projectDir: project, outDir }),
    /01-typo: blueprint "device-surface-showcses" has no file/,
  );
  assert.equal(existsSync(outDir), false);
});

test("an uninstalled animation skill degrades with a warning, it does not fail the run", () => {
  // hyperframes-animation installs on demand, so an absent blueprints/ means the
  // library isn't there yet — not that the frame named a bad id. Matches how an
  // absent rules/ already behaves.
  const project = mkdtempSync(join(tmpdir(), "plv-blueprint-uninstalled-"));
  write(join(project, "frame.md"), "# tokens\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Hook\n\n- duration: 3s\n- src: compositions/frames/01-hook.html\n- blueprint: dataviz-countup (Adapt)\n`,
  );

  const [packet] = buildFramePackets({
    projectDir: project,
    animationDir: join(project, "absent-animation-skill"),
  });

  assert.doesNotMatch(readFileSync(packet.path, "utf8"), /## Selected blueprint/);
});
