import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { ltxVideoGenerate } from "./ltx-video-provider.mjs";

const fittingSpecs = { availableRamMB: 20000, gpu: { present: true } };

test("no fitting local model: falls through without checking for a binary", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls = [];

  const result = await ltxVideoGenerate(
    "a calm ocean wave at sunset",
    { specs: { availableRamMB: 100, gpu: { present: true } } },
    (...call) => calls.push(call),
    () => true,
  );

  assert.equal(result, null);
  assert.deepEqual(calls, []);
});

test("binary missing from PATH: prints the model install hint and falls through", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(message));
  const calls = [];
  const fakeExec = (...call) => {
    calls.push(call);
    throw new Error("not found");
  };

  const result = await ltxVideoGenerate(
    "a calm ocean wave at sunset",
    { specs: fittingSpecs },
    fakeExec,
  );

  assert.equal(result, null);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["which", ["ltx-2-mlx"]]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /git clone https:\/\/github\.com\/dgrauet\/ltx-2-mlx/);
  // the install hint is the accept moment: say what the pull costs
  assert.match(errors[0], /GB of weights to/);
});

test("generate argv substitutes a spaced prompt after tokenizing and uses verified defaults", async () => {
  const calls = [];
  const checkedPaths = [];
  const fakeExec = (...call) => calls.push(call);
  const pathExists = (path) => {
    checkedPaths.push(path);
    return false;
  };
  const intent = "a calm ocean wave at sunset";

  const result = await ltxVideoGenerate(intent, { specs: fittingSpecs }, fakeExec, pathExists);

  assert.equal(result, null);
  assert.equal(calls.length, 2);
  const [bin, argv, opts] = calls[1];
  assert.equal(bin, "ltx-2-mlx");
  assert.equal(opts.timeout, 1_800_000);

  const expectedPairs = [
    ["--prompt", intent],
    ["--width", "512"],
    ["--height", "320"],
    ["--frames", "33"],
    ["--output", checkedPaths[0]],
  ];
  let previousIndex = -1;
  for (const [flag, value] of expectedPairs) {
    const index = argv.indexOf(flag);
    assert.ok(index > previousIndex, `${flag} should follow the previous required option`);
    assert.equal(argv[index + 1], value);
    previousIndex = index;
  }
  assert.equal(argv.filter((arg) => arg === intent).length, 1);
});

test("successful generation returns the generated MP4 result", async () => {
  const calls = [];
  const fakeExec = (...call) => calls.push(call);
  const intent = "a calm ocean wave at sunset";

  const result = await ltxVideoGenerate(intent, { specs: fittingSpecs }, fakeExec, () => true);

  assert.ok(result);
  assert.equal(calls.length, 2);
  assert.equal(dirname(result.localPath), tmpdir());
  assert.match(result.localPath, /media-use-ltx-\d+-\d+\.mp4$/);
  assert.deepEqual(result, {
    localPath: result.localPath,
    ext: ".mp4",
    source: "generated",
    metadata: {
      description: intent,
      provider: "ltx.local",
      provenance: { prompt: intent },
    },
  });
});

test("generate failure returns null instead of throwing", async (t) => {
  t.mock.method(console, "error", () => {});
  let calls = 0;
  const fakeExec = () => {
    calls += 1;
    if (calls === 2) {
      const error = new Error("generation failed");
      error.stderr = "LTX failed";
      throw error;
    }
  };

  const result = await ltxVideoGenerate(
    "storm clouds",
    { specs: fittingSpecs },
    fakeExec,
    () => true,
  );

  assert.equal(result, null);
  assert.equal(calls, 2);
});

test("missing generated output returns null and says so", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(message));

  const result = await ltxVideoGenerate(
    "storm clouds",
    { specs: fittingSpecs },
    () => {},
    () => false,
  );

  assert.equal(result, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /wrote no output file/);
});

// 40GB clears BOTH videogen tiers, so the ladder has two rungs. `fittingSpecs`
// above sits under the large tier's floor on purpose: every other test in this
// file exercises the medium tier alone, which is precisely why a broken large
// tier could sit in the table unnoticed.
const bothTiersSpecs = { availableRamMB: 40000, gpu: { present: true } };

const isGenerate = (call) => call[0] !== "which";

test("a top tier that cannot run demotes to the next fitting tier", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(message));
  const calls = [];
  // The runner is installed, but the large tier's weights are gated: the
  // download 401s and `generate` exits non-zero. The medium tier then works.
  const fakeExec = (...call) => {
    calls.push(call);
    if (isGenerate(call) && call[1].includes("dgrauet/ltx-2.3-mlx-q8")) {
      const err = new Error("exit 1");
      err.stderr = "401 Client Error: Unauthorized for url: .../ltx-2.3-mlx-q8";
      throw err;
    }
  };

  const result = await ltxVideoGenerate(
    "storm clouds",
    { specs: bothTiersSpecs },
    fakeExec,
    () => true,
  );

  assert.ok(result, "the medium tier still produced a video");
  const generated = calls.filter(isGenerate).map((call) => call[1].join(" "));
  assert.equal(generated.length, 2, "large attempted first, then medium");
  assert.match(generated[0], /dgrauet\/ltx-2\.3-mlx-q8/);
  assert.match(generated[1], /dgrauet\/ltx-2\.3-mlx-q4/);
  // the demotion is reported, never silent: a smaller model changes the output
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ltx-2\.3-mlx-q8\) failed/);
  assert.match(errors[0], /401/);
});

test("every fitting tier failing returns null, one reason per tier", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(message));
  const fakeExec = (...call) => {
    if (isGenerate(call)) throw new Error("mlx out of memory");
  };

  const result = await ltxVideoGenerate(
    "storm clouds",
    { specs: bothTiersSpecs },
    fakeExec,
    () => true,
  );

  assert.equal(result, null);
  assert.equal(errors.length, 2, "both tiers tried, both reported");
  assert.match(errors[0], /ltx-2\.3-mlx-q8/);
  assert.match(errors[1], /ltx-2\.3-mlx-q4/);
});

test("preferTier pins the attempt to one tier instead of demoting", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls = [];
  const fakeExec = (...call) => {
    calls.push(call);
    if (isGenerate(call)) throw new Error("boom");
  };

  const result = await ltxVideoGenerate(
    "storm clouds",
    { specs: bothTiersSpecs, preferTier: "large" },
    fakeExec,
    () => true,
  );

  assert.equal(result, null);
  const generated = calls.filter(isGenerate).map((call) => call[1].join(" "));
  assert.equal(generated.length, 1, "pinned to large: no demotion to medium");
  assert.match(generated[0], /dgrauet\/ltx-2\.3-mlx-q8/);
});

// A failed attempt's temp path is minted per attempt (it carries a timestamp),
// so without cleanup a partial mp4 from a failed tier is orphaned rather than
// overwritten - and a lower tier then succeeding hides it. Partial video files
// are the expensive case, which is why this is pinned.
const outputOf = (argv) => argv[argv.indexOf("--output") + 1];

test("a failed attempt's partial output is discarded before demoting", async (t) => {
  t.mock.method(console, "error", () => {});
  const unlinked = [];
  const attempted = [];
  const fakeExec = (...call) => {
    if (!isGenerate(call)) return;
    attempted.push(outputOf(call[1]));
    if (call[1].includes("dgrauet/ltx-2.3-mlx-q8")) {
      // OOM mid-write is one of the advertised demotion cases
      const err = new Error("exit 1");
      err.stderr = "mlx.core.metal: out of memory";
      throw err;
    }
  };

  const result = await ltxVideoGenerate(
    "storm clouds",
    { specs: bothTiersSpecs },
    fakeExec,
    () => true,
    (path) => unlinked.push(path),
  );

  assert.ok(result, "the medium tier still produced a video");
  assert.deepEqual(unlinked, [attempted[0]], "the failed large-tier partial is removed");
});

test("every tier failing discards every partial, one per attempt", async (t) => {
  t.mock.method(console, "error", () => {});
  const unlinked = [];
  const attempted = [];
  const fakeExec = (...call) => {
    if (!isGenerate(call)) return;
    attempted.push(outputOf(call[1]));
    throw new Error("mlx out of memory");
  };

  const result = await ltxVideoGenerate(
    "storm clouds",
    { specs: bothTiersSpecs },
    fakeExec,
    () => true,
    (path) => unlinked.push(path),
  );

  assert.equal(result, null);
  assert.equal(attempted.length, 2, "both tiers attempted");
  assert.deepEqual(unlinked, attempted, "nothing is left behind on the all-fail path");
});

test("a successful generation is never discarded", async () => {
  const unlinked = [];

  const result = await ltxVideoGenerate(
    "storm clouds",
    { specs: bothTiersSpecs },
    () => {},
    () => true,
    (path) => unlinked.push(path),
  );

  assert.ok(result);
  assert.deepEqual(unlinked, [], "the returned artifact must survive");
});

test("an unremovable partial does not mask the generate failure", async (t) => {
  t.mock.method(console, "error", () => {});
  const fakeExec = (...call) => {
    if (isGenerate(call)) throw new Error("mlx out of memory");
  };

  const result = await ltxVideoGenerate(
    "storm clouds",
    { specs: bothTiersSpecs },
    fakeExec,
    () => true,
    () => {
      throw new Error("EPERM: operation not permitted");
    },
  );

  // cleanup is best-effort: a partial we cannot delete must not become the error
  assert.equal(result, null);
});
