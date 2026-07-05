import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  listModels,
  meetsSpecs,
  selectModel,
  describeModelLadder,
  CAPABILITIES,
} from "./local-models.mjs";

const TIERS = ["small", "medium", "large", "xlarge"];

const strongGpu = {
  ramMB: 64000,
  gpu: { present: true, kind: "nvidia", vramMB: 24000 },
  appleSilicon: false,
};
const cpuOnly = { ramMB: 16000, gpu: { present: false, vramMB: 0 }, appleSilicon: false };
const tiny = { ramMB: 1024, gpu: { present: false, vramMB: 0 }, appleSilicon: false };

test("every capability table is non-empty and well-formed", () => {
  for (const cap of CAPABILITIES) {
    const models = listModels(cap);
    assert.ok(models.length > 0, `no models for ${cap}`);
    for (const m of models) {
      assert.ok(m.id && m.tier && m.needs, `${cap}/${m.id} missing fields`);
      assert.ok(TIERS.includes(m.tier), `${cap}/${m.id} bad tier: ${m.tier}`);
      assert.equal(typeof m.install, "string", `${cap}/${m.id} needs an install command`);
      assert.equal(typeof m.invoke, "string", `${cap}/${m.id} needs an invoke command`);
      // user-installed, local-use-only: there is NO license gate on selection
      assert.equal("license" in m, false, `${cap}/${m.id} must not carry a license gate`);
    }
  }
});

test("meetsSpecs enforces RAM, GPU presence, and VRAM", () => {
  const gpuModel = { needs: { ramMB: 8000, gpu: true, vramMB: 12000 } };
  assert.equal(meetsSpecs(gpuModel, strongGpu), true);
  assert.equal(meetsSpecs(gpuModel, cpuOnly), false, "no GPU -> fails a GPU model");
  const cpuModel = { needs: { ramMB: 2000, gpu: false } };
  assert.equal(meetsSpecs(cpuModel, cpuOnly), true);
  assert.equal(meetsSpecs(cpuModel, tiny), false, "too little RAM");
});

test("Apple Silicon unified memory counts as VRAM", () => {
  const apple = {
    ramMB: 24000,
    appleSilicon: true,
    gpu: { present: true, kind: "apple", vramMB: 24000 },
  };
  const gpuModel = { needs: { ramMB: 8000, gpu: true, vramMB: 16000 } };
  assert.equal(meetsSpecs(gpuModel, apple), true);
});

test("selectModel picks the large tier on a strong machine", () => {
  const r = selectModel("tts", strongGpu);
  assert.equal(r.tier, "large");
  assert.ok(r.model.id);
});

test("selectModel falls back to medium on a CPU-only machine", () => {
  const r = selectModel("tts", cpuOnly);
  assert.equal(r.tier, "medium");
  assert.equal(r.model.id, "kokoro", "Kokoro is the CPU/medium default (native word timestamps)");
});

test("selectModel recommends the CLI path when no tier fits", () => {
  const r = selectModel("tts", tiny);
  assert.equal(r.recommend, "cli");
  assert.ok(r.reason && /spec/i.test(r.reason));
  assert.equal(r.model, undefined);
});

test("preferTier:'medium' avoids the large model even on a strong machine", () => {
  const r = selectModel("tts", strongGpu, { preferTier: "medium" });
  assert.equal(r.tier, "medium");
});

test("selectModel gates on AVAILABLE RAM, not total, when both are present", () => {
  // 64GB total but only 6GB free right now -> the large tier must not be chosen.
  const busy = {
    ramMB: 64000,
    availableRamMB: 6000,
    appleSilicon: true,
    gpu: { present: true, kind: "apple", vramMB: 64000 },
  };
  const r = selectModel("tts", busy);
  assert.equal(r.tier, "medium", "available RAM (6GB) rules out the 16GB large tier");
});

test("imagegen is a RAM-graduated ladder; agent picks the best that fits", () => {
  const ladder = describeModelLadder("imagegen", {
    ramMB: 24000,
    availableRamMB: 12000,
    appleSilicon: true,
    gpu: { present: true, kind: "apple", vramMB: 24000 },
  });
  // best-first order, each flagged with fit
  assert.ok(ladder.length >= 3, "imagegen offers multiple RAM tiers");
  assert.ok(
    ladder[0].needsRamMB >= ladder[ladder.length - 1].needsRamMB,
    "ladder is ordered best (biggest) first",
  );
  // on 24GB / 12GB-free the schnell --low-ram tier fits, the 32GB+ tiers do not
  const fitting = ladder.filter((m) => m.fits);
  assert.ok(fitting.length >= 1, "at least the low-ram tier fits a 24GB Mac");
  assert.ok(
    fitting.every((m) => m.needsRamMB <= 12000),
    "only sub-budget models flagged as fitting",
  );
  const pick = selectModel("imagegen", {
    ramMB: 24000,
    availableRamMB: 12000,
    gpu: { present: true, vramMB: 24000 },
  });
  assert.equal(
    pick.model.id,
    "flux-schnell-mflux-q4",
    "best fit on 24GB is the low-ram schnell tier",
  );
});

test("imagegen on a 64GB Mac steps up to the higher-quality tier", () => {
  const pick = selectModel("imagegen", {
    ramMB: 96000,
    availableRamMB: 80000,
    gpu: { present: true, vramMB: 96000 },
  });
  assert.equal(pick.tier, "xlarge", "80GB free unlocks the top-quality model");
});

test("ASR prefers Parakeet by rank even though it is smaller than whisper", () => {
  // quality != size for ASR: Parakeet 0.6B beats whisper-1.5B, so `rank` wins
  // over footprint. On a capable machine both fit; Parakeet must be chosen.
  const capable = {
    ramMB: 24000,
    availableRamMB: 12000,
    appleSilicon: true,
    gpu: { present: true, kind: "apple", vramMB: 24000 },
  };
  const pick = selectModel("asr", capable);
  assert.equal(pick.model.id, "parakeet-mlx", "Parakeet is the rank-0 preferred ASR");
  // whisperx (rank 1, CPU-only) is the fallback when no GPU
  const cpu = { ramMB: 16000, availableRamMB: 12000, gpu: { present: false, vramMB: 0 } };
  assert.equal(selectModel("asr", cpu).model.id, "whisperx", "CPU-only falls back to whisperx");
});

test("ASR offers word-timestamp-capable models (better than plain whisper)", () => {
  const asr = listModels("asr");
  assert.ok(
    asr.every((m) => m.wordTimestamps),
    "every ASR model must support word timestamps",
  );
});
