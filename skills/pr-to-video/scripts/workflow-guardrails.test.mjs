import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";

import { parsePrReference, resolvePrToVideoProjectDir } from "./project-dir.mjs";
import { buildFramePackets } from "./frame-packets.mjs";
import { hasCliCommand, runCliPreflight } from "./preflight.mjs";

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
    join(
      cache,
      "hyperframes",
      "pr-to-video",
      "everyinc",
      "compound-engineering-plugin",
      "compound-engineering-plugin-pr-1092",
    ),
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

test("distinct owner and repository segments cannot collide in the durable cache", () => {
  const cache = mkdtempSync(join(tmpdir(), "p2v-cache-collision-"));
  const first = resolvePrToVideoProjectDir({
    pr: "foo-bar/baz#1",
    env: { XDG_CACHE_HOME: cache },
  });
  const second = resolvePrToVideoProjectDir({
    pr: "foo/bar-baz#1",
    env: { XDG_CACHE_HOME: cache },
  });

  assert.notEqual(first, second);
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
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Diff\n\n- duration: 4s\n- src: compositions/frames/01-diff.html\n- focal: code-diff\n- blueprint: compose\n- rules: text-reveal\n\n### Source excerpt\n\n\`\`\`diff\n-oldCall()\n+newCall({ attested: true })\n\`\`\`\n\n## Frame 2 — Impact\n\n- duration: 3s\n- src: compositions/frames/02-impact.html\n- blueprint: dataviz-countup\n- rules: counting-dynamic-scale\n`,
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
  assert.doesNotMatch(codePacket, /code-scroll/);
  assert.ok(Buffer.byteLength(codePacket) < 32_000);
  assert.ok(result.every((packet) => packet.path.endsWith(".md")));

  const role = readFileSync(join(project, ".hyperframes", "frame-packets", "_role.md"), "utf8");
  assert.match(role, /# Frame worker — core contract/);
  assert.match(role, /# Frame worker — PR-to-video delta/);
});

test("packet validation is atomic and leaves no partial output on overflow", () => {
  const project = mkdtempSync(join(tmpdir(), "p2v-packets-atomic-"));
  const outDir = join(project, ".hyperframes", "frame-packets");
  write(join(project, "frame.md"), "# frame\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Intro\n\n- duration: 2s\n- src: compositions/frames/01-intro.html\n\n## Frame 2 — Diff\n\n- duration: 4s\n- src: compositions/frames/02-diff.html\n- focal: code-diff\n\n### Source excerpt\n\n\`\`\`diff\n${"+oversized line\n".repeat(300)}\`\`\`\n`,
  );

  assert.throws(
    () => buildFramePackets({ projectDir: project, outDir, maxPacketBytes: 2_000 }),
    /limit 2000/,
  );
  assert.equal(existsSync(outDir), false);
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

// The other half of this skill's frame-packets delta. The excerpt guard above is
// pinned; the code-vocabulary injection was not — deleting `codeVocabularySection`
// outright left all 455 skills tests green, so the section a code worker reads to
// pick its registry block could have been dropped silently.
test("a code frame carries the vocabulary excerpt for the block it names", () => {
  const project = mkdtempSync(join(tmpdir(), "p2v-packets-vocab-"));
  write(join(project, "frame.md"), "# frame\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Diff\n\n- duration: 4s\n- src: compositions/frames/01-diff.html\n- focal: code-diff\n\n### Source excerpt\n\n\`\`\`diff\n-oldCall()\n+newCall()\n\`\`\`\n`,
  );

  const [packet] = buildFramePackets({ projectDir: project });
  const contents = readFileSync(packet.path, "utf8");

  assert.match(contents, /## Code block excerpt \(code-diff\)/);
  assert.match(contents, /`code-diff`/);
});

test("a code block the vocabulary does not describe still names itself for install", () => {
  const project = mkdtempSync(join(tmpdir(), "p2v-packets-vocab-miss-"));
  write(join(project, "frame.md"), "# frame\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Diff\n\n- duration: 4s\n- src: compositions/frames/01-diff.html\n- focal: code-not-in-the-vocabulary\n\n### Source excerpt\n\n\`\`\`diff\n-oldCall()\n+newCall()\n\`\`\`\n`,
  );

  const [packet] = buildFramePackets({ projectDir: project });

  assert.match(
    readFileSync(packet.path, "utf8"),
    /## Code block\n\nUse registry block `code-not-in-the-vocabulary`\./,
  );
});

test("a mechanism frame gets no code-block section at all", () => {
  const project = mkdtempSync(join(tmpdir(), "p2v-packets-mechanism-"));
  write(join(project, "frame.md"), "# frame\n");
  write(
    join(project, "STORYBOARD.md"),
    `---\nformat: 1920x1080\n---\n\n## Frame 1 — Mechanism\n\n- duration: 4s\n- src: compositions/frames/01-mechanism.html\n- focal: the request-lifecycle flow\n`,
  );

  const [packet] = buildFramePackets({ projectDir: project });

  assert.doesNotMatch(readFileSync(packet.path, "utf8"), /## Code block/);
});

test("CLI capability detection rejects skills newer than the available command surface", () => {
  const stableHelp = `Project:\n  lint  Validate a composition\n  snapshot  Capture frames\n\nUnknown command check`;
  const currentHelp = `Project:\n  lint  Validate a composition\n  check Run the full project validation gate\n  snapshot  Capture frames`;

  assert.equal(hasCliCommand(stableHelp, "check"), false);
  assert.equal(hasCliCommand(currentHelp, "check"), true);
});

test("CLI preflight delegates capability probing to the plugin launcher", () => {
  let calls = 0;
  assert.equal(
    runCliPreflight({
      spawn(command, args, options) {
        calls += 1;
        assert.equal(command, process.execPath);
        assert.deepEqual(args, [
          fileURLToPath(new URL("../../hyperframes/scripts/plugin-cli.mjs", import.meta.url)),
          "--help",
        ]);
        assert.equal(options.shell, false);
        return { status: 0, stdout: "  check Validate project", stderr: "" };
      },
    }),
    true,
  );
  assert.equal(calls, 1);
});

function installedProbeFixture(t, plugin) {
  const root = mkdtempSync(join(tmpdir(), "hf-probe install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const preflight = join(root, "skills/pr-to-video/scripts/preflight.mjs");
  mkdirSync(dirname(preflight), { recursive: true });
  copyFileSync(new URL("./preflight.mjs", import.meta.url), preflight);
  if (plugin) {
    const launcher = join(root, "skills/hyperframes/scripts/plugin-cli.mjs");
    mkdirSync(dirname(launcher), { recursive: true });
    copyFileSync(new URL("../../hyperframes/scripts/plugin-cli.mjs", import.meta.url), launcher);
    write(join(root, "plugin.json"), JSON.stringify({ name: "hyperframes", version: "1.2.3" }));
  }
  const bin = join(root, "bin");
  const receipt = join(root, "argv.json");
  const shim = `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(receipt)}, JSON.stringify(process.argv.slice(2))); console.log("  check Validate project");`;
  write(join(bin, "npx"), `#!${process.execPath}\n${shim}`);
  chmodSync(join(bin, "npx"), 0o755);
  write(join(bin, "npx-cli.js"), shim);
  write(
    join(bin, "npx.cmd"),
    `@echo off\r\n"${process.execPath}" "${join(bin, "npx-cli.js")}" %*\r\n`,
  );
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ""}`;
  env.npm_execpath = join(bin, "npm-cli.js");
  return { preflight, env, receipt };
}

test("installed capability probe never launches unpinned npx", (t) => {
  const { preflight, env, receipt } = installedProbeFixture(t, true);
  const result = spawnSync(process.execPath, [preflight], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(receipt, "utf8")), [
    "--yes",
    "hyperframes@1.2.3",
    "--help",
  ]);
});

test("single-skill standalone preflight fetches its explicitly pinned release", (t) => {
  const { preflight, env, receipt } = installedProbeFixture(t, false);
  const result = spawnSync(process.execPath, [preflight, "4.5.6"], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(receipt, "utf8")), [
    "--yes",
    "hyperframes@4.5.6",
    "--help",
  ]);
});
test("standalone preflight rejects floating releases before spawning", () => {
  for (const cliVersion of ["latest", "^1.2.3", "1.2.3 & echo unsafe"]) {
    assert.throws(
      () =>
        runCliPreflight({
          cliVersion,
          spawn() {
            assert.fail("must not spawn");
          },
        }),
      /exact CLI release/,
    );
  }
});
