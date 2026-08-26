import { execFileSync } from "node:child_process";
import { selectModel, selectModelLadder } from "./local-models.mjs";
import { probeSpecs } from "./specs.mjs";

// Run a USER-INSTALLED local model for a capability (tts/asr/upscale).
// Walks the tiers the machine supports best-first (selectModelLadder), checking
// the tool is on PATH, filling the model's invoke template, and running it. A
// tier whose tool is missing or whose run fails demotes to the next fitting
// tier, so one unusable entry does not fail the capability. Returns:
//   { model, tier, out }                              on success
//   { recommend:"install", model, sizeMB, command, reason }  tool isn't installed
//   { recommend:"cli", reason }                        when no tier fits the machine
// `exec` / `which` are injectable for tests.
//
// ponytail: "installed" = the invoke's first token is on PATH (e.g. `whisperx`,
// `realesrgan-ncnn-vulkan`). For `python -m kokoro` this only proves python
// exists; good enough to gate — the recommend.command names the real package.
// Upgrade to a per-tool probe if a "python present but package missing" run ever
// produces a confusing error instead of a clean recommend.

function defaultWhich(bin) {
  execFileSync("command", ["-v", bin], { stdio: "ignore", shell: true });
}

function defaultExec(cmd) {
  execFileSync(cmd, { stdio: ["ignore", "pipe", "pipe"], shell: true, timeout: 600000 });
}

const fill = (tpl, vars) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));

export function runLocalModel(capability, opts = {}) {
  const {
    specs = probeSpecs(),
    exec = defaultExec,
    which = defaultWhich,
    vars = {},
    preferTier,
  } = opts;
  const ladder = selectModelLadder(capability, specs, { preferTier });
  // no tier fits at all -> recommend the CLI path (selectModel words the reason)
  if (!ladder.length) return selectModel(capability, specs, { preferTier });

  // Best tier first, demoting past any tier that cannot run here: a missing
  // tool or a failed run at the top tier must not hide a lower tier that works
  // (fish-speech absent should still get you Kokoro). The last tier's failure is
  // what gets reported, since by then nothing local ran.
  let lastFailure = null;
  for (const model of ladder) {
    const bin = model.invoke.split(/\s+/)[0];
    try {
      which(bin);
    } catch {
      lastFailure = {
        recommend: "install",
        model: model.id,
        sizeMB: model.sizeMB,
        command: model.install,
        reason: `${model.id} not installed (~${(model.sizeMB / 1000).toFixed(1)}GB to download once it is)`,
      };
      continue;
    }
    try {
      exec(fill(model.invoke, vars));
    } catch (e) {
      lastFailure = {
        recommend: "install",
        model: model.id,
        sizeMB: model.sizeMB,
        command: model.install,
        reason: e.message || String(e),
      };
      continue;
    }
    return { model: model.id, tier: model.tier, out: vars.out };
  }
  return lastFailure;
}
