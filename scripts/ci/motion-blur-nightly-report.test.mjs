import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classify, workflowCommand } from "./motion-blur-nightly-report.mjs";

const SCRIPT = join(import.meta.dirname, "motion-blur-nightly-report.mjs");

const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
if [ "$1 $2" = "issue list" ]; then
  [ "$*" = "issue list --state open --limit 1000 --json title --jq .[].title" ] || { echo "unexpected gh arguments: $*" >&2; exit 2; }
  [ -n "$STUB_LIST_FAIL" ] && { echo "boom" >&2; exit 1; }
  cat "$STUB_TITLES"
  exit 0
fi
if [ "$1 $2" = "issue create" ]; then
  while [ $# -gt 0 ]; do [ "$1" = "--body-file" ] && { cat "$2"; echo "====="; } >> "$STUB_LOG.bodies"; shift; done
fi
exit 0
`;

function night({
  files = {},
  titles = [],
  generatedResult = "failure",
  args = [],
  listFails = false,
}) {
  const dir = mkdtempSync(join(tmpdir(), "nightly-report-test-"));
  const failures = join(dir, "failures");
  for (const [artifact, records] of Object.entries(files)) {
    mkdirSync(join(failures, `blur-nightly-failures-${artifact}`), { recursive: true });
    writeFileSync(
      join(failures, `blur-nightly-failures-${artifact}`, "blur-nightly-failures.json"),
      JSON.stringify(records),
    );
  }
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "gh"), STUB);
  chmodSync(join(dir, "bin", "gh"), 0o755);
  writeFileSync(join(dir, "titles.txt"), titles.map((t) => `${t}\n`).join(""));
  const summary = join(dir, "summary.md");
  const run = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--failures",
      failures,
      "--generated-result",
      generatedResult,
      "--date",
      "2026-11-06",
      "--run-url",
      "https://example.test/run/1",
      "--summary",
      summary,
      ...args,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        STUB_LOG: join(dir, "gh.log"),
        STUB_TITLES: join(dir, "titles.txt"),
        STUB_LIST_FAIL: listFails ? "1" : "",
      },
    },
  );
  const calls = existsSync(join(dir, "gh.log"))
    ? readFileSync(join(dir, "gh.log"), "utf8").split("\n").filter(Boolean)
    : [];
  return {
    run,
    calls,
    lists: calls.filter((c) => c.startsWith("issue list")),
    creates: calls.filter((c) => c.startsWith("issue create")),
    summary: existsSync(summary) ? readFileSync(summary, "utf8") : "",
    dir,
  };
}

const real = (seed, problems = ["outside the trail at 0.5: 3 bad tiles"], features = ["mask"]) => ({
  seed,
  features,
  problems,
});

test("one issue per failing seed, titled by seed, with the flavours that failed", () => {
  const n = night({ files: { "pin-1": [real(7)], "stable-1": [real(7), real(9)] } });
  assert.equal(n.run.status, 0, n.run.stderr);
  assert.equal(n.lists.length, 1);
  assert.equal(n.creates.length, 2);
  assert.match(n.creates[0], /--title motion blur nightly: seed 7 /);
  assert.match(n.creates[1], /--title motion blur nightly: seed 9 /);
  assert.match(n.creates[0], /--label bug --label area\/quality/);
  const [first, second] = readFileSync(join(n.dir, "gh.log.bodies"), "utf8").split("=====\n");
  assert.match(first, /Chrome flavours that failed: `pin`, `stable`/);
  assert.match(first, /^\[pin\] outside the trail at 0.5/m);
  assert.match(first, /^\[stable\] outside the trail at 0.5/m);
  assert.match(second, /Chrome flavours that failed: `stable`/);
  assert.match(first, /HF_BLUR_SEEDS=7 /);
  rmSync(n.dir, { recursive: true });
});

test("the title match is exact: an open seed 129 issue does not hide seed 12", () => {
  const n = night({
    files: { "pin-1": [real(12), real(129)] },
    titles: ["motion blur nightly: seed 129", "unrelated"],
  });
  assert.equal(n.creates.length, 1);
  assert.match(n.creates[0], /seed 12 /);
  assert.match(n.run.stdout, /skipping "motion blur nightly: seed 129"/);
  rmSync(n.dir, { recursive: true });
});

test("open titles are fetched once, however many seeds fail", () => {
  const n = night({ files: { "pin-1": [real(1), real(2), real(3), real(4), real(5)] } });
  assert.equal(n.lists.length, 1);
  assert.equal(n.creates.length, 5);
  rmSync(n.dir, { recursive: true });
});

test("more than 5 failing seeds open one systemic issue and no per-seed issue", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7].map((s) => real(s));
  const n = night({ files: { "pin-1": seeds, "stable-1": seeds } });
  assert.equal(n.creates.length, 1);
  assert.match(n.creates[0], /--title motion blur nightly: systemic failure 2026-11-06 /);
  assert.ok(!n.creates[0].includes("seed 1 "));
  rmSync(n.dir, { recursive: true });
});

test("the systemic title is deduped like the others", () => {
  const seeds = [1, 2, 3, 4, 5, 6].map((s) => real(s));
  const n = night({
    files: { "pin-1": seeds },
    titles: ["motion blur nightly: systemic failure 2026-11-06"],
  });
  assert.equal(n.creates.length, 0);
  assert.match(n.run.stdout, /skipping "motion blur nightly: systemic failure 2026-11-06"/);
  rmSync(n.dir, { recursive: true });
});

test("the cap applies before any per-seed work", () => {
  const seeds = [1, 2, 3, 4].map((s) => real(s));
  const n = night({
    files: { "pin-1": seeds },
    args: ["--max-issues", "2", "--systemic-above", "10"],
  });
  assert.equal(n.creates.length, 2);
  assert.equal(n.lists.length, 1);
  assert.match(n.run.stdout, /::warning::4 failing seeds; the first 2 get an issue/);
  rmSync(n.dir, { recursive: true });
});

test("a crash record becomes an issue", () => {
  const n = night({
    files: { "pin-1": [real(33, ["Error: Test timed out in 120000ms."], ["webgl"])] },
  });
  assert.equal(n.creates.length, 1);
  assert.match(n.creates[0], /seed 33 /);
  rmSync(n.dir, { recursive: true });
});

test("unstable seeds go to the summary and one warning, never to an issue", () => {
  const n = night({
    files: {
      "pin-1": [
        { seed: 129, features: ["canvas2d", "svgClip"], problems: [], unstableReference: 2.03 },
      ],
      "stable-1": [{ seed: 130, features: ["mask"], problems: [], unstableReference: 1.5 }],
    },
    generatedResult: "success",
  });
  assert.equal(n.run.status, 0, n.run.stderr);
  assert.equal(n.calls.length, 0);
  assert.equal(n.run.stdout.match(/::warning::/g)?.length, 1);
  assert.match(
    n.run.stdout,
    /::warning::2 seed\(s\) had a blur-off reference that disagrees with itself.*129, 130/,
  );
  assert.match(n.summary, /\| 129 \| `canvas2d, svgClip` \| `pin` \| 2\.03 \|/);
  rmSync(n.dir, { recursive: true });
});

test("a failed job with no record warns and writes the summary", () => {
  const n = night({ files: { "pin-1": [], "stable-1": [] }, generatedResult: "failure" });
  assert.equal(n.run.status, 0, n.run.stderr);
  assert.equal(n.calls.length, 0);
  assert.match(
    n.run.stdout,
    /::warning::A generated job ended failure without recording a failing seed/,
  );
  assert.match(n.summary, /ended `failure` without recording a failing seed/);
  rmSync(n.dir, { recursive: true });
});

test("a failed job with no artifacts at all warns the same way", () => {
  const n = night({ generatedResult: "failure" });
  assert.match(n.run.stdout, /::warning::A generated job ended failure without recording/);
  rmSync(n.dir, { recursive: true });
});

test("a launch failure record warns and goes to the summary", () => {
  const n = night({
    files: {
      "stable-1": [{ seed: null, features: [], problems: ["Chrome lacks drawElementImage"] }],
    },
  });
  assert.equal(n.calls.length, 0);
  assert.match(
    n.run.stdout,
    /::warning::The nightly did not run cleanly: stable: Chrome lacks drawElementImage/,
  );
  assert.match(n.summary, /did not start/);
  assert.ok(!n.run.stdout.includes("without recording"));
  rmSync(n.dir, { recursive: true });
});

test("a green night with nothing to say opens nothing and warns of nothing", () => {
  const n = night({ files: { "pin-1": [], "stable-1": [] }, generatedResult: "success" });
  assert.equal(n.calls.length, 0);
  assert.ok(!n.run.stdout.includes("::warning::"));
  assert.match(n.summary, /No failing and no unstable seeds/);
  rmSync(n.dir, { recursive: true });
});

test("a failed open-title fetch fails the job instead of risking duplicates", () => {
  const n = night({ files: { "pin-1": [real(5)] }, listFails: true });
  assert.notEqual(n.run.status, 0);
  assert.equal(n.creates.length, 0);
  rmSync(n.dir, { recursive: true });
});

test("a seed that is not an integer never reaches a title", () => {
  const n = night({ files: { "pin-1": [real("1; echo x"), real(4)] } });
  assert.equal(n.creates.length, 1);
  assert.match(n.creates[0], /seed 4 /);
  assert.match(n.summary, /record without a usable seed/);
  rmSync(n.dir, { recursive: true });
});

test("classify groups a seed across flavours and prefixes each finding with its flavour", () => {
  const { failing } = classify([
    { ...real(8, ["a"]), flavour: "pin" },
    { ...real(8, ["b"]), flavour: "stable" },
  ]);
  assert.deepEqual(failing, [
    {
      seed: 8,
      features: ["mask"],
      flavours: ["pin", "stable"],
      problems: ["[pin] a", "[stable] b"],
    },
  ]);
});

const commandLines = (stdout) => stdout.split("\n").filter((line) => line.startsWith("::"));

test("the open-title fetch uses exactly the flags the report relies on", () => {
  const n = night({ files: { "pin-1": [real(5)] } });
  assert.equal(n.lists[0], "issue list --state open --limit 1000 --json title --jq .[].title");
  rmSync(n.dir, { recursive: true });
});

test("a job that was cancelled or timed out warns like a failed one", () => {
  for (const generatedResult of ["cancelled", "skipped"]) {
    const n = night({ files: { "pin-1": [] }, generatedResult });
    assert.match(
      n.run.stdout,
      new RegExp(`::warning::A generated job ended ${generatedResult} without`),
    );
    rmSync(n.dir, { recursive: true });
  }
});

test("workflowCommand escapes data and properties the way the runner does", () => {
  assert.equal(workflowCommand("warning", "a%b\r\nc"), "::warning::a%25b%0D%0Ac");
  assert.equal(
    workflowCommand("warning", "m", { file: "x:y,z\n" }),
    "::warning file=x%3Ay%2Cz%0A::m",
  );
});

test("workflowCommand leaves no :: in its message, so text on one line cannot start a command", () => {
  const line = workflowCommand("warning", "x ::add-mask::secret ::stop-commands::t :::y");
  assert.equal(line, "::warning::x : :add-mask: :secret : :stop-commands: :t : : :y");
  assert.equal(line.slice("::warning::".length).includes("::"), false);
});

test("untrusted newlines never start a second workflow command", () => {
  const hostile = "1\n::error::pwned";
  const n = night({
    files: {
      "stable-1": [
        { seed: hostile, features: [], problems: [] },
        {
          seed: null,
          features: [],
          problems: ["Chrome died\n::error::pwned %0A\r::warning::again"],
        },
        { seed: 3, features: [], problems: [], unstableReference: 1.5 },
      ],
    },
  });
  assert.equal(n.run.status, 0, n.run.stderr);
  const commands = commandLines(n.run.stdout);
  assert.equal(commands.length, 2);
  assert.ok(commands.every((line) => line.startsWith("::warning::")));
  assert.ok(
    !n.run.stdout
      .split("\n")
      .some((line) => /^::error/.test(line) || line.startsWith("::warning::again")),
  );
  const setup = commands.find((line) => line.includes("did not run cleanly"));
  assert.ok(setup.includes("Chrome died%0A: :error: :pwned %250A%0D: :warning: :again"), setup);
  assert.ok(setup.includes("record without a usable seed (1%0A: :error: :pwned)"));
  rmSync(n.dir, { recursive: true });
});

test("summary and issue text cannot break out of code, the table or mention anyone", () => {
  const nasty = "bad | cell @someone ```` and ``` <img src=x onerror=1>\n@other";
  const n = night({
    files: {
      "pin-1": [
        { seed: 8, features: ["a|b", "@someone", "<b>x</b>", "`tick`"], problems: [nasty] },
        {
          seed: 9,
          features: ["m|n", "@someone", "<b>x</b>", "`tick`", "p\\|q"],
          problems: [],
          unstableReference: 2,
        },
        { seed: null, features: [], problems: [nasty] },
      ],
    },
  });
  const body = readFileSync(join(n.dir, "gh.log.bodies"), "utf8").split("=====\n")[0];
  const fence = body.match(/^(`{4,})$/m);
  assert.ok(fence, "the findings sit in a fence longer than any backtick run in the text");
  assert.equal(fence[1].length, 5);
  const [outside, inside, after] = body.split(fence[1]);
  assert.ok(inside.includes("<img src=x onerror=1>") && inside.includes("@other"));
  assert.ok(!outside.replace(/`[^`\n]*`/g, "").includes("@someone"));
  assert.ok(!outside.includes("<img") && !after.includes("<img"));
  assert.match(outside, /- Features: `a\\\|b, @someone, <b>x<\/b>, 'tick'`/);
  const row = n.summary.split("\n").find((line) => line.startsWith("| 9 "));
  assert.equal(row, "| 9 | `m\\|n, @someone, <b>x</b>, 'tick', p\\\\\\|q` | `pin` | 2.00 |");
  const setupFence = n.summary.match(/^(`{4,})$/m);
  assert.ok(setupFence);
  assert.ok(!n.summary.replace(/^(`{5})$[\s\S]*?^\1$/gm, "").includes("<img"));
  rmSync(n.dir, { recursive: true });
});
