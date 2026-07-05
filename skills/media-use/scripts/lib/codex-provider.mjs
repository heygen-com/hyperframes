import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Image generation via the OpenAI Codex CLI's native image_gen tool. Runs on
// the user's ChatGPT subscription: the codex CLI owns auth (CLI-only
// invariant, media-use holds no keys) and generation carries no per-call
// charge, so the provider is network-but-not-paid, like the heygen catalog.
// Fallback AFTER heygen search: catalog miss -> generated image.
const TIMEOUT_MS = 240000; // image_gen round-trips the sub; ~1-2 min typical

export async function codexImageGenerate(intent) {
  const outPath = join(tmpdir(), `media-use-codex-${process.pid}-${Date.now()}.png`);
  const prompt =
    `Use your native image_gen tool to generate one image: ${intent}. ` +
    `Save the raster result to exactly this path: ${outPath} . ` +
    `If you have no native image generation tool, do nothing. ` +
    `Do not draw a substitute with PIL, matplotlib, or SVG.`;
  try {
    execFileSync("codex", ["exec", "--skip-git-repo-check", "-s", "workspace-write", prompt], {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: tmpdir(),
    });
  } catch (err) {
    console.error(
      `media-use: \`codex exec\` image generation failed: ${err.stderr?.toString().trim().slice(-200) || err.message}`,
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
      provider: "codex.image_gen",
      provenance: { prompt: intent },
    },
  };
}
