import { test } from "node:test";
import assert from "node:assert/strict";
import { mfluxImageGenerate } from "./mflux-provider.mjs";

// 40GB clears the 32GB klein tier and the 8GB schnell tier below it; the 64GB
// qwen tier stays out of reach. Two rungs is what makes demotion observable.
const bothTiersSpecs = { availableRamMB: 40000, gpu: { present: true } };
const SNAPSHOT = "/tmp/hf-snapshot";

// exec stub covering all three shells-out mflux does: the PATH probe, the
// idempotent `hf download`, and the generate itself.
function stubExec({ failGenerateFor = [], failWhichFor = [] } = {}) {
  const calls = [];
  const exec = (...call) => {
    calls.push(call);
    const [bin, argv] = call;
    if (bin === "which") {
      if (failWhichFor.includes(argv[0])) throw new Error("not found");
      return "";
    }
    if (bin === "hf") return `Fetching 6 files...\n${SNAPSHOT}\n`;
    if (failGenerateFor.some((id) => argv.join(" ").includes(id))) {
      const err = new Error("exit 1");
      err.stderr = "mlx.core.metal: out of memory";
      throw err;
    }
    return "";
  };
  return { calls, exec };
}

const generateCalls = (calls) =>
  calls.filter(([bin]) => bin !== "which" && bin !== "hf").map(([, argv]) => argv.join(" "));

test("no local model fits: falls through to the upsell without shelling out", async () => {
  const { calls, exec } = stubExec();

  const result = await mfluxImageGenerate(
    "a red bicycle",
    { specs: { availableRamMB: 100, gpu: { present: true } } },
    exec,
    () => true,
  );

  assert.equal(result, null);
  assert.deepEqual(calls, []);
});

test("a top tier that cannot run demotes to the next fitting tier", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(message));
  const { calls, exec } = stubExec({ failGenerateFor: ["flux2-klein-4b"] });

  const result = await mfluxImageGenerate(
    "a red bicycle",
    { specs: bothTiersSpecs },
    exec,
    () => true,
  );

  assert.ok(result, "the schnell tier still produced an image");
  assert.equal(result.metadata.provider, "mflux.flux-schnell-mflux-q4");
  const generated = generateCalls(calls);
  assert.equal(generated.length, 2, "klein attempted first, then schnell");
  assert.match(generated[0], /flux2-klein-4b/);
  assert.match(generated[1], /--model schnell/);
  assert.equal(errors.length, 1, "the demotion is reported, not silent");
  assert.match(errors[0], /flux2-klein-mflux-q4\) failed/);
});

test("a snapshot that will not resolve demotes rather than failing outright", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(message));
  const calls = [];
  const exec = (...call) => {
    calls.push(call);
    const [bin, argv] = call;
    if (bin === "which") return "";
    // klein's weights won't download; schnell's do
    if (bin === "hf") {
      if (argv[1].includes("FLUX.2-klein")) throw new Error("403 Forbidden");
      return `${SNAPSHOT}\n`;
    }
    return "";
  };

  const result = await mfluxImageGenerate(
    "a red bicycle",
    { specs: bothTiersSpecs },
    exec,
    () => true,
  );

  assert.ok(result, "demoted past the ungettable weights");
  assert.equal(result.metadata.provider, "mflux.flux-schnell-mflux-q4");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /hf download failed/);
});

test("runner missing from PATH reports the install hint per tier and returns null", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(message));
  const { exec } = stubExec({ failWhichFor: ["mflux-generate"] });

  const result = await mfluxImageGenerate(
    "a red bicycle",
    { specs: bothTiersSpecs },
    exec,
    () => true,
  );

  assert.equal(result, null);
  assert.equal(errors.length, 2, "both fitting tiers reported");
  assert.match(errors[0], /uv pip install mflux/);
});
