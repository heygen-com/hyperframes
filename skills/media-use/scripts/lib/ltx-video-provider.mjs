import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDownload, probeSpecs } from "./specs.mjs";
import { buildArgv, selectModel, selectModelLadder } from "./local-models.mjs";

export async function ltxVideoGenerate(
  intent,
  ctx,
  execFn = execFileSync,
  pathExists = existsSync,
  unlinkFn = unlinkSync,
) {
  const specs = ctx?.specs || probeSpecs();
  const ladder = selectModelLadder("videogen", specs, { preferTier: ctx?.preferTier });
  if (!ladder.length) {
    const { reason } = selectModel("videogen", specs, { preferTier: ctx?.preferTier });
    console.error(
      `media-use: local video gen not enabled (${reason}). Enable a fitting free on-device LTX model to use this provider.`,
    );
    return null;
  }

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

  // Walk the whole ladder, best tier first. A tier that cannot run on this
  // machine for a reason no spec check sees (runner off PATH, gated weights, an
  // OOM) demotes to the next fitting tier instead of failing local video gen
  // outright. Every demotion is reported: a silent drop to a smaller model
  // leaves the caller wondering why the output looks the way it does.
  for (const model of ladder) {
    const bin = model.invoke.trim().split(/\s+/)[0];
    try {
      execFn("which", [bin], { stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      console.error(
        `media-use: local video gen not enabled (\`${bin}\` not on PATH). Install for free on-device LTX: ${model.install}. Heads up: ${model.id} ${describeDownload(model.sizeMB)}.`,
      );
      continue;
    }

    const outPath = join(tmpdir(), `media-use-ltx-${process.pid}-${Date.now()}.mp4`);
    const argv = buildArgv(model.invoke, {
      prompt: intent,
      w: ctx?.width || 512,
      h: ctx?.height || 320,
      frames: ctx?.frames || 33,
      out: outPath,
    });
    argv.shift();

    try {
      execFn(bin, argv, {
        encoding: "utf8",
        timeout: 1_800_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      discardPartial(outPath);
      console.error(
        `media-use: local video gen (${model.id}) failed: ${err.stderr?.toString().trim().slice(-200) || err.message}`,
      );
      continue;
    }
    if (!pathExists(outPath)) {
      console.error(
        `media-use: local video gen (${model.id}) exited cleanly but wrote no output file`,
      );
      continue;
    }
    return {
      localPath: outPath,
      ext: ".mp4",
      source: "generated",
      metadata: {
        description: intent,
        provider: "ltx.local",
        provenance: { prompt: intent },
      },
    };
  }
  return null;
}
