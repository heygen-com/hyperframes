import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeSpecs } from "./specs.mjs";
import { buildArgv, selectModel } from "./local-models.mjs";

export async function ltxVideoGenerate(
  intent,
  ctx,
  execFn = execFileSync,
  pathExists = existsSync,
) {
  const specs = ctx?.specs || probeSpecs();
  const sel = selectModel("videogen", specs, { preferTier: ctx?.preferTier });
  if (sel.recommend) {
    console.error(
      `media-use: local video gen not enabled (${sel.reason}). Enable a fitting free on-device LTX model to use this provider.`,
    );
    return null;
  }

  const { model } = sel;
  const bin = model.invoke.trim().split(/\s+/)[0];
  try {
    execFn("which", [bin], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    console.error(
      `media-use: local video gen not enabled (\`${bin}\` not on PATH). Install for free on-device LTX: ${model.install}`,
    );
    return null;
  }

  const outPath = join(tmpdir(), `media-use-ltx-${process.pid}-${Date.now()}.mp4`);
  const width = ctx?.width || 512;
  const height = ctx?.height || 320;
  const frames = ctx?.frames || 33;
  const argv = buildArgv(model.invoke, {
    prompt: intent,
    w: width,
    h: height,
    frames,
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
    console.error(
      `media-use: local video gen (${model.id}) failed: ${err.stderr?.toString().trim().slice(-200) || err.message}`,
    );
    return null;
  }
  if (!pathExists(outPath)) return null;
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
