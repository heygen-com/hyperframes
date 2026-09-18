import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  attachCommand,
  evaluate,
  hasMedia,
  parseNumstat,
  parseSections,
} from "./check-pr-captures.mjs";

const ASSET = "https://github.com/user-attachments/assets/9173dafa-203a-447a-be3a-1234567890ab";
const studio = (path, lines = 50) => ({ path, lines });
const captured = `## Before\n![old](${ASSET})\n\n## After\n${ASSET}\n`;

test("a PR that touches neither package needs nothing", () => {
  assert.equal(evaluate({ body: "", files: [] }).ok, true);
});

test("Before and After each with an attachment pass", () => {
  assert.equal(evaluate({ body: captured, files: [studio("packages/studio/src/A.tsx")] }).ok, true);
});

test("a missing After heading fails and names it", () => {
  const { ok, problems } = evaluate({
    body: `## Before\n![x](${ASSET})`,
    files: [studio("packages/player/src/a.ts")],
  });
  assert.equal(ok, false);
  assert.deepEqual(problems, ['the body has no "After" heading']);
});

test("a heading with no media fails and names the section", () => {
  const body = `## Before\nlooked bad\n\n## After\n![x](${ASSET})`;
  const { problems } = evaluate({ body, files: [studio("packages/studio/src/a.ts")] });
  assert.deepEqual(problems, ['the "Before" section has no image or video']);
});

test("media in the wrong section does not count", () => {
  const body = `## What\n![x](${ASSET})\n## Before\nnone\n## After\nnone`;
  assert.equal(evaluate({ body, files: [studio("packages/studio/src/a.ts")] }).ok, false);
});

test("a local file reference is not an attachment", () => {
  assert.equal(hasMedia("![shot](./before.png)"), false);
});

test("an image link and a video link count", () => {
  assert.equal(hasMedia("[clip](https://example.com/a/b.mp4?raw=1)"), true);
  assert.equal(hasMedia("![alt](https://example.com/shot.png)"), true);
  assert.equal(hasMedia('<video src="https://example.com/x.webm"></video>'), true);
  assert.equal(hasMedia("[docs](https://example.com/page)"), false);
});

test("headings inside a code fence are ignored", () => {
  const sections = parseSections("```\n## Before\n```\n## After\nx");
  assert.deepEqual(
    sections.map((s) => s.title),
    ["After"],
  );
});

test("a nested heading stays inside its section", () => {
  const sections = parseSections(`## Before\n### Wide\n${ASSET}\n## After\nz`);
  assert.equal(hasMedia(sections[0].text), true);
});

test("No visible change passes for a small non-visual diff", () => {
  const body = "## No visible change\nrename of an internal type";
  assert.equal(evaluate({ body, files: [studio("packages/studio/src/types.ts", 8)] }).ok, true);
});

test("No visible change fails at 20 lines and says why", () => {
  const body = "## No visible change\nx";
  const { ok, problems } = evaluate({ body, files: [studio("packages/studio/src/a.ts", 20)] });
  assert.equal(ok, false);
  assert.match(problems[0], /changes 20 lines .* under 20/);
});

test("No visible change fails on a .tsx file even when tiny, and names the file", () => {
  const body = "## No visible change\nx";
  const { problems } = evaluate({ body, files: [studio("packages/studio/src/Button.tsx", 1)] });
  assert.match(problems[0], /touches .*Button\.tsx/);
});

test("both No visible change conditions are reported together", () => {
  const body = "## No visible change\nx";
  const { problems } = evaluate({ body, files: [studio("packages/studio/src/a.css", 90)] });
  assert.equal(problems.filter((p) => p.startsWith('"No visible change"')).length, 2);
});

test("numstat keeps only watched paths and counts added plus deleted", () => {
  const files = parseNumstat(
    "3\t2\tpackages/studio/src/a.ts\0" + "9\t9\tdocs/x.md\0" + "1\t0\tpackages/player/src/b.ts\0",
  );
  assert.deepEqual(files, [
    studio("packages/studio/src/a.ts", 5),
    studio("packages/player/src/b.ts", 1),
  ]);
});

test("a binary file spends the whole no-visible-change budget", () => {
  const [file] = parseNumstat("-\t-\tpackages/studio/public/logo.png\0");
  assert.equal(file.lines, 20);
});

test("the failure prints the exact attach command", () => {
  assert.equal(attachCommand(4127), "gh pr edit 4127 --attach ./before.png --attach ./after.png");
});

const changed = [studio("packages/studio/src/a.ts")];

test("an image inside an HTML comment does not count", () => {
  const body = `## Before\n<!-- ![x](${ASSET}) -->\n## After\n${ASSET}`;
  assert.deepEqual(evaluate({ body, files: changed }).problems, [
    'the "Before" section has no image or video',
  ]);
});

test("an image inside a code fence does not count", () => {
  const body = "## Before\n```\n" + ASSET + "\n```\n## After\n" + ASSET;
  assert.equal(evaluate({ body, files: changed }).ok, false);
});

test("one image cannot serve both sections when After is nested under Before", () => {
  const body = `## Before\n### After\n${ASSET}`;
  const { problems } = evaluate({ body, files: changed });
  assert.deepEqual(problems, ['the "Before" section has no image or video']);
});

test("Before and After with a qualifier count, other words do not", () => {
  assert.equal(
    evaluate({ body: `## Before (guides off)\n${ASSET}\n## After: on\n${ASSET}`, files: changed })
      .ok,
    true,
  );
  assert.equal(
    evaluate({
      body: `## Before you merge\n${ASSET}\n## After the merge\n${ASSET}`,
      files: changed,
    }).ok,
    false,
  );
});

test("setext headings are recognised", () => {
  assert.equal(
    evaluate({ body: `Before\n======\n${ASSET}\nAfter\n-----\n${ASSET}`, files: changed }).ok,
    true,
  );
});

test("an embedded image counts without a media extension, a plain link to a page does not", () => {
  assert.equal(hasMedia("![shot](https://example.com/shot)"), true);
  assert.equal(hasMedia('<img src="https://example.com/shot">'), true);
  assert.equal(hasMedia("[shot](https://example.com/shot)"), false);
});

test("the attachment host must be github.com itself", () => {
  assert.equal(
    hasMedia("https://evil.example/https://github.com/user-attachments/assets/abc"),
    false,
  );
  assert.equal(hasMedia("https://github.com.evil.example/user-attachments/assets/abc"), false);
  assert.equal(hasMedia("https://github.com/user-attachments/assets/abc-123"), true);
});

test("comment fragments cannot rebuild a comment or hide a section from the reader", () => {
  const body = `## Before\n<!<!-- -->-- ![x](${ASSET}) -->\n## After\n${ASSET}`;
  assert.equal(evaluate({ body, files: changed }).ok, false);
  assert.equal(
    evaluate({ body: `## Before\n${ASSET}\n## After\n<!-- ${ASSET}`, files: changed }).ok,
    false,
  );
});

test("No visible change accepts a test-only .tsx change but not a component change", () => {
  const body = "## No visible change\nx";
  assert.equal(evaluate({ body, files: [studio("packages/studio/src/A.test.tsx", 5)] }).ok, true);
  assert.equal(evaluate({ body, files: [studio("packages/studio/src/A.tsx", 5)] }).ok, false);
});

test("a renamed-in file is a plain path with --no-renames -z output", () => {
  const [file] = parseNumstat("5\t0\tpackages/studio/a.tsx\0");
  assert.equal(file.path, "packages/studio/a.tsx");
});

test("the script still runs when its path contains a space", () => {
  const dir = mkdtempSync(join(tmpdir(), "captures sp "));
  const copy = join(dir, "check.mjs");
  copyFileSync(new URL("./check-pr-captures.mjs", import.meta.url), copy);
  const result = spawnSync("node", [copy, "--base", "nonexistent-ref-xyz"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot diff/);
});

test("a line above a horizontal rule is not turned into a heading unless it is a capture title", () => {
  const body = `## Before\n![x](${ASSET})\n---\n## After\n${ASSET}`;
  assert.equal(evaluate({ body, files: changed }).ok, true);
});

test("Before-and-after is not a Before heading", () => {
  assert.equal(
    evaluate({ body: `## Before-and-after\n${ASSET}\n## After\n${ASSET}`, files: changed }).ok,
    false,
  );
});

test("a fence closes only with its own character and at least its length", () => {
  const tilde = `## After\n${ASSET}\n## Before\n~~~\n\`\`\`\n${ASSET}\n~~~`;
  assert.equal(evaluate({ body: tilde, files: changed }).ok, false);
  const long = `## Before\n${ASSET}\n\`\`\`\`\n\`\`\`\n## After\n\`\`\`\`\n## After\n${ASSET}`;
  assert.equal(evaluate({ body: long, files: changed }).ok, true);
});

test("an indented backtick line is code, not a fence", () => {
  const body = `## Before\n${ASSET}\n    \`\`\`\n## After\n${ASSET}`;
  assert.equal(evaluate({ body, files: changed }).ok, true);
});

test("CRLF bodies parse the same as LF bodies", () => {
  const body = `## Before\r\n${ASSET}\r\n## After\r\n${ASSET}\r\n`;
  assert.equal(evaluate({ body, files: changed }).ok, true);
});

test("a heading or media URL must match whole, not as a substring", () => {
  assert.equal(hasMedia("https://example.com/a.png.html"), false);
  assert.equal(hasMedia("https://github.com/user-attachments/assets/"), false);
  assert.equal(
    evaluate({ body: `## Not Before\n${ASSET}\n## Not After\n${ASSET}`, files: changed }).ok,
    false,
  );
});
