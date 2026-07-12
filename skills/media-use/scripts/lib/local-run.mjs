import { execFileSync } from "node:child_process";
import { selectModel } from "./local-models.mjs";
import { probeSpecs } from "./specs.mjs";

// Run a USER-INSTALLED local model for a capability (tts/asr/upscale).
// Picks the best tier the machine supports (selectModel), checks the tool is on
// PATH, fills the model's invoke template, and runs it. Returns:
//   { model, tier, out }                              on success
//   { recommend:"install", model, command, reason }   when the tool isn't installed
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
  const sel = selectModel(capability, specs, { preferTier });
  if (sel.recommend) return sel; // no tier fits -> recommend the CLI path

  const { model } = sel;
  const bin = model.invoke.split(/\s+/)[0];
  try {
    which(bin);
  } catch {
    return {
      recommend: "install",
      model: model.id,
      command: model.install,
      reason: `${model.id} not installed`,
    };
  }
  try {
    exec(fill(model.invoke, vars));
  } catch (e) {
    return {
      recommend: "install",
      model: model.id,
      command: model.install,
      reason: e.message || String(e),
    };
  }
  return { model: model.id, tier: sel.tier, out: vars.out };
}
