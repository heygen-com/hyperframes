import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  blocking,
  isFork,
  attachCommand,
  downloadAsset,
  duplicateCaptureProblems,
  LimitExceeded,
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

const OLD = "https://github.com/user-attachments/assets/aaaaaaaa-0000-4000-8000-000000000001";
const NEW = "https://github.com/user-attachments/assets/bbbbbbbb-0000-4000-8000-000000000002";
const sameBytes = "https://github.com/user-attachments/assets/cccccccc-0000-4000-8000-000000000003";
const OLD2 = "https://github.com/user-attachments/assets/eeeeeeee-0000-4000-8000-000000000005";
const bytesByUrl = { [OLD]: "old", [NEW]: "new", [sameBytes]: "old", [OLD2]: "older" };
const fromMap = async (url) => {
  if (!(url in bytesByUrl)) throw new Error("HTTP 404");
  return Buffer.from(bytesByUrl[url]);
};
const bodyWith = (before, after) => `## Before\n${before}\n\n## After\n${after}\n`;
const clean = { unreadable: [], identical: [], refused: [] };
const dupes = (body) => duplicateCaptureProblems(body, fromMap);

test("an After asset with different bytes than every Before asset passes", async () => {
  assert.deepEqual(await dupes(bodyWith(`[a](${OLD})`, `[b](${NEW})`)), clean);
});

test("an After asset with the same bytes as a Before asset fails, even under another URL", async () => {
  const { identical } = await dupes(bodyWith(`[a](${OLD})`, `[b](${sameBytes})`));
  assert.deepEqual(identical, [
    `After asset ${sameBytes} is byte-identical to Before asset ${OLD}`,
  ]);
});

test("the same URL under both headings fails", async () => {
  const { identical } = await dupes(bodyWith(`[a](${OLD})`, `[b](${OLD})`));
  assert.equal(identical.length, 1);
});

test("a duplicate of the second Before asset is found, not only of the first", async () => {
  const { identical } = await dupes(bodyWith(`[a](${OLD2})\n[b](${OLD})`, `[c](${sameBytes})`));
  assert.deepEqual(identical, [
    `After asset ${sameBytes} is byte-identical to Before asset ${OLD}`,
  ]);
});

test("one duplicate among several After assets is still found", async () => {
  const { identical } = await dupes(bodyWith(`[a](${OLD})`, `[b](${NEW})\n[c](${sameBytes})`));
  assert.deepEqual(identical, [
    `After asset ${sameBytes} is byte-identical to Before asset ${OLD}`,
  ]);
});

test("an asset that cannot be downloaded is a problem, not a pass", async () => {
  const missing = "https://github.com/user-attachments/assets/dddddddd-0000-4000-8000-000000000004";
  const { unreadable } = await dupes(bodyWith(`[a](${OLD})`, `[b](${missing})`));
  assert.deepEqual(unreadable, [`could not download After asset ${missing}: HTTP 404`]);
});

test("a body without both headings has nothing to compare", async () => {
  assert.deepEqual(await dupes(`## Before\n[a](${OLD})`), clean);
});

test("a URL that is not a GitHub attachment is never fetched", async () => {
  const fetched = [];
  const spy = async (url) => (fetched.push(url), Buffer.from("x"));
  const other = "http://169.254.169.254/latest/x.png";
  await duplicateCaptureProblems(bodyWith(`![a](${other})`, `![b](${other})`), spy);
  assert.deepEqual(fetched, []);
});

const ok = () => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new TextEncoder().encode("x").buffer,
});
const noSleep = async () => {};

test("downloadAsset retries a 5xx or a network error with backoff and stops after three attempts", async () => {
  const outcomes = [{ ok: false, status: 502 }, new Error("socket hang up"), ok()];
  let calls = 0;
  const sleeps = [];
  const flaky = async () => {
    const next = outcomes[calls++];
    if (next instanceof Error) throw next;
    return next;
  };
  assert.equal((await downloadAsset(OLD, flaky, async (ms) => sleeps.push(ms))).toString(), "x");
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [1000, 3000]);
  calls = 0;
  await assert.rejects(
    downloadAsset(OLD, async () => (calls++, { ok: false, status: 500 }), noSleep),
    /HTTP 500/,
  );
  assert.equal(calls, 3);
});

test("downloadAsset does not retry a 404 or 403", async () => {
  for (const status of [404, 403]) {
    let calls = 0;
    await assert.rejects(
      downloadAsset(OLD, async () => (calls++, { ok: false, status }), noSleep),
      new RegExp(`HTTP ${status}`),
    );
    assert.equal(calls, 1);
  }
});

const redirect = (location) => ({ ok: false, status: 302, headers: new Headers({ location }) });

test("downloadAsset follows a redirect to signed storage but not to another host", async () => {
  const signed = "https://github-production-user-asset-6210df.s3.amazonaws.com/1/clip.mp4?X-Amz=1";
  const seen = [];
  const viaS3 = async (url) => (seen.push(url), url === OLD ? redirect(signed) : ok());
  assert.equal((await downloadAsset(OLD, viaS3, noSleep)).toString(), "x");
  assert.deepEqual(seen, [OLD, signed]);

  const internal = "https://metadata.internal.example/latest/x.png";
  const toInternal = async (url) => (seen.push(url), redirect(internal));
  seen.length = 0;
  await assert.rejects(downloadAsset(OLD, toInternal, noSleep), /not a GitHub asset host/);
  assert.deepEqual(seen, [OLD]);
});

test("downloadAsset asks for manual redirects so every hop is checked", async () => {
  let asked;
  await downloadAsset(OLD, async (_url, init) => ((asked = init.redirect), ok()), noSleep);
  assert.equal(asked, "manual");
});

test("a redirect over plain http is refused even to a trusted host", async () => {
  const insecure = "http://github.com/user-attachments/assets/x";
  await assert.rejects(
    downloadAsset(OLD, async () => redirect(insecure), noSleep),
    /not a GitHub asset host/,
  );
});

test("the duplicate check is skipped when the PR touches neither package", () => {
  const dir = mkdtempSync(join(tmpdir(), "captures-gate-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
  const copy = join(dir, "check.mjs");
  copyFileSync(new URL("./check-pr-captures.mjs", import.meta.url), copy);
  const body = bodyWith(`[a](${OLD})`, `[b](${OLD})`);
  const result = spawnSync("node", [copy, "--base", "main", "--head", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PR_BODY: body },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("a redirect to another S3 bucket is refused, GitHub's asset bucket is not", async () => {
  const other = "https://attacker-bucket.s3.amazonaws.com/x.mp4";
  await assert.rejects(
    downloadAsset(OLD, async () => redirect(other), noSleep),
    /not a GitHub asset host/,
  );
  const lookalike = "https://github-production-user-asset-1.s3.amazonaws.com.evil.example/x";
  await assert.rejects(
    downloadAsset(OLD, async () => redirect(lookalike), noSleep),
    /not a GitHub asset host/,
  );
});

const streamOf = (...sizes) => ({
  ok: true,
  status: 200,
  body: new ReadableStream({
    start(controller) {
      for (const size of sizes) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  }),
});
const MB = 1024 * 1024;

test("downloadAsset refuses one asset over the per-asset cap", async () => {
  await assert.rejects(
    downloadAsset(OLD, async () => streamOf(60 * MB, 60 * MB), noSleep),
    /larger than/,
  );
});

test("downloadAsset refuses once the shared budget is spent, across assets", async () => {
  const budget = { left: 150 * MB };
  const get = async () => streamOf(90 * MB);
  await downloadAsset(OLD, get, noSleep, budget);
  await assert.rejects(downloadAsset(NEW, get, noSleep, budget), /together exceed/);
});

test("an unreadable capture blocks a same-repo PR but is skipped on a fork", () => {
  const same = { HEAD_REPO: "a/r", BASE_REPO: "a/r" };
  const fork = { HEAD_REPO: "someone/r", BASE_REPO: "a/r" };
  assert.equal(isFork(same), false);
  assert.equal(isFork(fork), true);
  assert.equal(isFork({}), false);
  assert.equal(isFork({ BASE_REPO: "a/r" }), false);
  assert.equal(blocking(["x"], [], same), true);
  assert.equal(blocking(["x"], [], fork), false);
  assert.equal(blocking([], ["dup"], fork), true);
});

test("the same link under both headings is caught without any download", async () => {
  let fetched = 0;
  const { identical } = await duplicateCaptureProblems(bodyWith(OLD, OLD), async () => {
    fetched++;
    return Buffer.from("x");
  });
  assert.equal(identical.length, 1);
  assert.equal(fetched, 0);
});

test("a plain http attachment link is never fetched", async () => {
  const insecure = OLD.replace("https:", "http:");
  const seen = [];
  await duplicateCaptureProblems(
    bodyWith(insecure, NEW),
    async (url) => (seen.push(url), Buffer.from(url)),
  );
  assert.deepEqual(seen, [NEW]);
});

test("a lookalike of a trusted host is refused as a redirect", async () => {
  for (const host of ["evilgithub.com", "github.com.evil.example", "notgithubusercontent.com"]) {
    await assert.rejects(
      downloadAsset(OLD, async () => redirect(`https://${host}/x`), noSleep),
      /not a GitHub asset host/,
    );
  }
});

test("a redirect loop stops after the redirect limit", async () => {
  let calls = 0;
  const loop = async () => (calls++, redirect("https://github.com/user-attachments/assets/loop"));
  await assert.rejects(downloadAsset(OLD, loop, noSleep), /too many redirects/);
  assert.equal(calls, 6);
});

test("a 429 is retried", async () => {
  let calls = 0;
  const limited = async () => (++calls < 2 ? { ok: false, status: 429 } : ok());
  assert.equal((await downloadAsset(OLD, limited, noSleep)).toString(), "x");
});

test("the body reader is cancelled when the cap stops a download", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull: (controller) => controller.enqueue(new Uint8Array(60 * MB)),
    cancel: () => (cancelled = true),
  });
  await assert.rejects(
    downloadAsset(OLD, async () => ({ ok: true, status: 200, body }), noSleep),
    /larger than/,
  );
  assert.equal(cancelled, true);
});

test("the deadline covers every attempt, so a slow asset is not retried past it", async () => {
  const deadline = new AbortController();
  let calls = 0;
  const failsAfterDeadline = async () => {
    calls++;
    deadline.abort();
    throw new Error("network");
  };
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = () => deadline.signal;
  try {
    await assert.rejects(downloadAsset(OLD, failsAfterDeadline, noSleep), /not finished within/);
  } finally {
    AbortSignal.timeout = realTimeout;
  }
  assert.equal(calls, 1);
});

function runCli(env, body = bodyWith(`[a](${OLD})`, `[b](${NEW})`)) {
  const dir = mkdtempSync(join(tmpdir(), "captures-cli-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
  git("checkout", "-q", "-b", "pr");
  mkdirSync(join(dir, "packages/studio/src"), { recursive: true });
  writeFileSync(join(dir, "packages/studio/src/a.ts"), "x\n".repeat(50));
  git("add", "-A");
  git("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "change");
  const copy = join(dir, "check.mjs");
  copyFileSync(new URL("./check-pr-captures.mjs", import.meta.url), copy);
  const preload = join(dir, "no-network.mjs");
  writeFileSync(preload, "globalThis.fetch = async () => ({ ok: false, status: 404 });\n");
  return spawnSync("node", ["--import", preload, copy, "--base", "main", "--head", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PR_BODY: body, ...env },
  });
}

test("the CLI fails a same-repo PR whose capture cannot be downloaded", () => {
  const result = runCli({ HEAD_REPO: "a/r", BASE_REPO: "a/r" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /could not be downloaded/);
});

test("the CLI skips, and says why, for a fork PR whose capture cannot be downloaded", () => {
  const result = runCli({ HEAD_REPO: "someone/r", BASE_REPO: "a/r" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /from a fork/);
});

const forkEnv = { HEAD_REPO: "someone/r", BASE_REPO: "a/r" };

test("our own cap tripping is refused, not counted as an unreadable download", async () => {
  const capped = async (url) => {
    if (url === NEW) throw new LimitExceeded("captures together exceed the budget");
    return Buffer.from("old");
  };
  const result = await duplicateCaptureProblems(bodyWith(`[a](${OLD})`, `[b](${NEW})`), capped);
  assert.equal(result.unreadable.length, 0);
  assert.equal(result.refused.length, 1);
  assert.equal(
    blocking(result.unreadable, [...result.identical, ...result.refused], forkEnv),
    true,
  );
});

test("a failed attempt gives its bytes back to the shared budget", async () => {
  const budget = { left: 150 * MB };
  let attempt = 0;
  let sent = 0;
  const flaky = async () => {
    if (++attempt > 1) return streamOf(1);
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        pull(controller) {
          if (sent++ === 0) controller.enqueue(new Uint8Array(50 * MB));
          else controller.error(new Error("connection reset"));
        },
      }),
    };
  };
  await downloadAsset(OLD, flaky, noSleep, budget);
  assert.equal(budget.left, 150 * MB - 1);
});

test("trailing punctuation and a query string do not change which asset a link names", async () => {
  const seen = [];
  const record = async (url) => (seen.push(url), Buffer.from(url));
  await duplicateCaptureProblems(bodyWith(`see ${OLD}.`, `${NEW}?raw=1, done`), record);
  assert.deepEqual(seen, [OLD, NEW]);
  const same = await duplicateCaptureProblems(bodyWith(OLD, `${OLD}?raw=1`), record);
  assert.equal(same.identical.length, 1);
});

test("more capture links than the limit is refused", async () => {
  const links = Array.from(
    { length: 13 },
    (_, i) =>
      `https://github.com/user-attachments/assets/${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
  );
  const result = await duplicateCaptureProblems(bodyWith(links.join("\n"), NEW), fromMap);
  assert.equal(result.refused.length, 1);
});

test("the CLI still fails a fork PR whose After link is a Before link", () => {
  const result = runCli({ HEAD_REPO: "someone/r", BASE_REPO: "a/r" }, bodyWith(OLD, OLD));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /same link/);
});

test("the CLI fails a fork PR that hits a limit of the check", () => {
  const links = Array.from(
    { length: 13 },
    (_, i) =>
      `https://github.com/user-attachments/assets/${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
  );
  const result = runCli(
    { HEAD_REPO: "someone/r", BASE_REPO: "a/r" },
    bodyWith(links.join("\n"), NEW),
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /limit of this check/);
});
