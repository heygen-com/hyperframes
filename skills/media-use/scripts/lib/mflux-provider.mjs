import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDownload, probeSpecs } from "./specs.mjs";
import { buildArgv, selectModelLadder } from "./local-models.mjs";

// Local image generation via mflux (FLUX-on-MLX), the Mac-native runner.
// Spec-gated: selectModelLadder("imagegen", specs) returns every FLUX-class
// model the machine's AVAILABLE RAM can actually run (medium FLUX-schnell
// --low-ram on ~24GB, up to Qwen-Image on 64GB+), best first. When nothing
// local fits, or no fitting tier can actually run here, this returns null so
// the registry falls through to the codex image upsell.
//
// The official FLUX repos are HF-gated, so the model entries point --path at
// non-gated community 4-bit re-uploads; the repo is resolved to a local snapshot
// (hf download, idempotent) because a bare repo id breaks mlx unflatten.

// Resolve an HF repo to its local snapshot dir. `hf download` is idempotent and
// prints the snapshot path as its last line.
function resolveSnapshot(repo, execFn, pathExists) {
  const out = execFn("hf", ["download", repo], {
    encoding: "utf8",
    timeout: 1_800_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const path = out?.trim().split(/\r?\n/).pop()?.trim();
  return path && pathExists(path) ? path : null;
}

export async function mfluxImageGenerate(
  intent,
  ctx,
  execFn = execFileSync,
  pathExists = existsSync,
  unlinkFn = unlinkSync,
) {
  const specs = ctx?.specs || probeSpecs();
  const ladder = selectModelLadder("imagegen", specs, { preferTier: ctx?.preferTier });
  if (!ladder.length) return null; // no local model fits -> codex upsell/fallback

  // Each attempt mints its own timestamped output path, so a partial artifact
  // from a failed tier is orphaned rather than overwritten - and a lower tier
  // then succeeding hides it. Discard it before demoting. Best-effort: a
  // partial we cannot remove must never mask the real failure.
  const discardPartial = (path) => {
    try {
      if (pathExists(path)) unlinkFn(path);
    } catch {
      // nothing actionable: the generate failure below is the real story
    }
  };

  // Best tier first, demoting past any tier that cannot run here (runner off
  // PATH, a snapshot that won't download, an OOM) rather than failing local
  // image gen outright. Every demotion is reported, so a quietly smaller model
  // is never mistaken for the tier the machine nominally qualified for.
  for (const model of ladder) {
    const bin = model.invoke.trim().split(/\s+/)[0];
    // Not installed? Surface the exact enable-command (before the model
    // download) so the agent learns the free local path is available instead of
    // silently taking the codex upsell.
    try {
      execFn("which", [bin], { stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      console.error(
        `media-use: local image gen not enabled (\`${bin}\` not on PATH). Install for free on-device FLUX: ${model.install}. Heads up: ${model.id} ${describeDownload(model.sizeMB)}.`,
      );
      continue;
    }

    const outPath = join(tmpdir(), `media-use-mflux-${process.pid}-${Date.now()}.png`);
    const vars = {
      prompt: intent,
      w: ctx?.width || 512,
      h: ctx?.height || 512,
      seed: ctx?.seed ?? 42,
      out: outPath,
    };
    if (model.repo && model.invoke.includes("{model_path}")) {
      let snap = null;
      let why = `could not resolve a local snapshot of ${model.repo}`;
      try {
        snap = resolveSnapshot(model.repo, execFn, pathExists);
      } catch (err) {
        why = `hf download failed: ${err.stderr?.toString().trim().slice(-200) || err.message}`;
      }
      if (!snap) {
        console.error(`media-use: local image gen (${model.id}): ${why}`);
        continue;
      }
      vars.model_path = snap;
    }

    const argv = buildArgv(model.invoke, vars);
    argv.shift(); // drop the bin (already validated)
    try {
      execFn(bin, argv, {
        encoding: "utf8",
        timeout: 1_800_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      discardPartial(outPath);
      console.error(
        `media-use: local image gen (${model.id}) failed: ${err.stderr?.toString().trim().slice(-200) || err.message}`,
      );
      continue;
    }
    if (!pathExists(outPath)) {
      console.error(
        `media-use: local image gen (${model.id}) exited cleanly but wrote no output file`,
      );
      continue;
    }
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
  return null;
}
