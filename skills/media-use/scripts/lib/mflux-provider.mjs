import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeSpecs } from "./specs.mjs";
import { selectModel } from "./local-models.mjs";

// Local image generation via mflux (FLUX-on-MLX), the Mac-native runner.
// Spec-gated: selectModel("imagegen", specs) returns the best FLUX-class model
// the machine's AVAILABLE RAM can actually run (medium FLUX-schnell --low-ram on
// ~24GB, up to Qwen-Image on 64GB+). When nothing local fits, this returns null
// so the registry falls through to the codex image upsell.
//
// The official FLUX repos are HF-gated, so the model entries point --path at
// non-gated community 4-bit re-uploads; the repo is resolved to a local snapshot
// (hf download, idempotent) because a bare repo id breaks mlx unflatten.

// Tokenize the invoke template on whitespace FIRST, then substitute each token,
// so a {prompt}/{model_path} value with spaces stays a single argv entry.
function buildArgv(template, vars) {
  return template
    .trim()
    .split(/\s+/)
    .map((tok) => tok.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)));
}

// Resolve an HF repo to its local snapshot dir. `hf download` is idempotent and
// prints the snapshot path as its last line.
function resolveSnapshot(repo) {
  const out = execFileSync("hf", ["download", repo], {
    encoding: "utf8",
    timeout: 1_800_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const path = out.trim().split(/\r?\n/).pop()?.trim();
  return path && existsSync(path) ? path : null;
}

export async function mfluxImageGenerate(intent, ctx) {
  const specs = ctx?.specs || probeSpecs();
  const sel = selectModel("imagegen", specs, { preferTier: ctx?.preferTier });
  if (sel.recommend) return null; // no local model fits -> codex upsell/fallback

  const { model } = sel;
  const bin = model.invoke.trim().split(/\s+/)[0];
  // Not installed? Surface the exact enable-command FIRST (before the model
  // download) so the agent learns the free local path is available instead of
  // silently taking the codex upsell.
  try {
    execFileSync("which", [bin], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    console.error(
      `media-use: local image gen not enabled (\`${bin}\` not on PATH). Install for free on-device FLUX: ${model.install}`,
    );
    return null;
  }

  const outPath = join(tmpdir(), `media-use-mflux-${process.pid}-${Date.now()}.png`);
  const width = ctx?.width || 512;
  const height = ctx?.height || 512;
  const seed = ctx?.seed ?? 42;

  const vars = { prompt: intent, w: width, h: height, seed, out: outPath };
  if (model.repo && model.invoke.includes("{model_path}")) {
    const snap = model.repo ? resolveSnapshot(model.repo) : null;
    if (!snap) return null;
    vars.model_path = snap;
  }

  const argv = buildArgv(model.invoke, vars);
  argv.shift(); // drop the bin (already validated)
  try {
    execFileSync(bin, argv, {
      encoding: "utf8",
      timeout: 1_800_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    console.error(
      `media-use: local image gen (${model.id}) failed: ${err.stderr?.toString().trim().slice(-200) || err.message}`,
    );
    return null;
  }
  if (!existsSync(outPath)) return null;
  return {
    localPath: outPath,
    ext: ".png",
    source: "generated",
    metadata: {
      description: intent,
      provider: `mflux.${model.id}`,
      provenance: { model: model.id, tier: model.tier, prompt: intent },
    },
  };
}
