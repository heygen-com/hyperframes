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

test("missing generated output returns null", async () => {
  const result = await ltxVideoGenerate(
    "storm clouds",
    { specs: fittingSpecs },
    () => {},
    () => false,
  );

  assert.equal(result, null);
});
