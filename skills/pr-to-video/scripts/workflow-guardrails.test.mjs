import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";

import { parsePrReference, resolvePrToVideoProjectDir } from "./project-dir.mjs";
import { buildFramePackets, buildWorkerBatches, canRetryFrame } from "./frame-packets.mjs";
import { hasCliCommand } from "./preflight.mjs";

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

test("default project directory is durable and outside the caller repository", () => {
  const caller = mkdtempSync(join(tmpdir(), "p2v-caller-"));
  const cache = mkdtempSync(join(tmpdir(), "p2v-cache-"));
  const result = resolvePrToVideoProjectDir({
    pr: "https://github.com/EveryInc/compound-engineering-plugin/pull/1092",
    cwd: caller,
    env: { XDG_CACHE_HOME: cache, HOME: homedir() },
  });

  assert.equal(
    result,
    join(cache, "hyperframes", "pr-to-video", "everyinc-compound-engineering-plugin-pr-1092"),
  );
  assert.ok(isAbsolute(result));
  assert.ok(relative(caller, result).startsWith(".."));
});

test("explicit project directory is preserved exactly after absolute resolution", () => {
  const caller = mkdtempSync(join(tmpdir(), "p2v-explicit-caller-"));
  assert.equal(
    resolvePrToVideoProjectDir({
      pr: "EveryInc/compound-engineering-plugin#1092",
      cwd: caller,
      explicitDir: "../my-video",
      env: {},
    }),
    resolve(caller, "../my-video"),
  );
});

test("PR parsing sanitizes owner and repository path traversal", () => {
  assert.deepEqual(
    parsePrReference("https://github.com/EveryInc/compound-engineering-plugin/pull/1092"),
    {
      owner: "everyinc",
      repo: "compound-engineering-plugin",
      number: 1092,
    },
  );
  assert.throws(() => parsePrReference("../../outside#1092"), /valid GitHub PR reference/i);
});

test("#1092 packets contain selected excerpts but never the full diff", () => {
  const project = mkdtempSync(join(tmpdir(), "p2v-packets-"));
  const largeDiff = `diff --git a/noise b/noise\n${"+unselected noise\n".repeat(10_000)}`;
  write(join(project, "capture", "diff.patch"), largeDiff);
  write(join(project, "frame.md"), "# compact frame tokens\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Diff\n\n- duration: 4s\n- src: compositions/frames/01-diff.html\n- blueprint: compose\n- rules: text-reveal\n\n### Source excerpt\n\n\`\`\`diff\n-oldCall()\n+newCall({ attested: true })\n\`\`\`\n\n## Frame 2 — Impact\n\n- duration: 3s\n- src: compositions/frames/02-impact.html\n- blueprint: number-lockup\n- rules: counting-dynamic-scale\n`,
  );

  const result = buildFramePackets({
    projectDir: project,
    storyboardPath: join(project, "STORYBOARD.md"),
    outDir: join(project, ".hyperframes", "frame-packets"),
    maxPacketBytes: 32_000,
  });

  assert.equal(result.length, 2);
  const codePacket = readFileSync(result[0].path, "utf8");
  assert.match(codePacket, /newCall\(\{ attested: true \}\)/);
  assert.doesNotMatch(codePacket, /unselected noise/);
  assert.ok(Buffer.byteLength(codePacket) < 32_000);
  assert.ok(result.every((packet) => packet.path.endsWith(".md")));
});

test("code frames without an upstream-selected excerpt fail before dispatch", () => {
  const project = mkdtempSync(join(tmpdir(), "p2v-packets-missing-"));
  write(join(project, "frame.md"), "# frame\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Diff\n\n- duration: 4s\n- src: compositions/frames/01-diff.html\n- focal: code-diff\n`,
  );

  assert.throws(
    () =>
      buildFramePackets({
        projectDir: project,
        storyboardPath: join(project, "STORYBOARD.md"),
        outDir: join(project, ".hyperframes", "frame-packets"),
      }),
    /Source excerpt/i,
  );
});

test("worker batches are bounded and a frame gets at most one targeted retry", () => {
  const packets = Array.from({ length: 8 }, (_, index) => ({ frameId: `0${index + 1}` }));
  const batches = buildWorkerBatches(packets, { maxWorkers: 3 });

  assert.equal(batches.length, 3);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [3, 3, 2],
  );
  assert.equal(canRetryFrame(0), true);
  assert.equal(canRetryFrame(1), false);
  assert.equal(canRetryFrame(2), false);
});

test("CLI capability detection rejects skills newer than the available command surface", () => {
  const stableHelp = `Project:\n  lint  Validate a composition\n  snapshot  Capture frames\n\nUnknown command check`;
  const currentHelp = `Project:\n  lint  Validate a composition\n  check  Run the full project validation gate\n  snapshot  Capture frames`;

  assert.equal(hasCliCommand(stableHelp, "check"), false);
  assert.equal(hasCliCommand(currentHelp, "check"), true);
});
