import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// fal generation via the genmedia CLI — fal's agent-first CLI for running hosted
// models (https://fal.ai/learn/devs/genmedia-cli-guide). NOT the `fal` pip
// package, which is the serverless-deploy CLI (`fal deploy/run <yourfunc>`) and
// can't call hosted endpoints like fal-ai/flux/schnell.
//   install: curl https://genmedia.sh/install -fsS | bash
//   auth:    genmedia setup --non-interactive --api-key "$FAL_KEY"
//   run:     genmedia run <model> --prompt "<text>" --download <tpl> --json
//            -> { downloaded_files: [{ path, url, ... }] }
// media-use holds no keys; the CLI owns auth (CLI-only invariant).
//
// ponytail: model ids are fal catalog endpoints — confirm availability + the
// prompt field for your account with `genmedia models "<q>" --json` and
// `genmedia schema <id> --json`. The CLI invocation matches the official guide;
// live generation is unverified here (no FAL_KEY in this environment).

const MODEL = { image: "fal-ai/flux/schnell", bgm: "fal-ai/minimax-music", sfx: "fal-ai/mmaudio" };

export function falGenerate(kind) {
  return async function generate(intent) {
    const model = MODEL[kind];
    if (!model) return null;
    // genmedia downloads the result itself; {placeholders} are filled by the CLI.
    const tpl = join(tmpdir(), "media-use-fal-{request_id}-{index}.{ext}");
    let out;
    try {
      out = execFileSync(
        "genmedia",
        ["run", model, "--prompt", intent, "--download", tpl, "--json"],
        { encoding: "utf8", timeout: 180000, stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (err) {
      const detail = err.stderr?.toString().trim() || err.message;
      console.error(`media-use: \`genmedia run ${model}\` failed: ${detail}`);
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      return null;
    }
    const file = parsed?.downloaded_files?.[0];
    // Prefer the local file genmedia already downloaded; fall back to its URL.
    const localPath = file?.path && existsSync(file.path) ? file.path : null;
    const url = file?.url || null;
    if (!localPath && !url) return null;
    return {
      ...(localPath ? { localPath } : { url }),
      source: "generated",
      metadata: { description: intent, provider: "fal", provenance: { model, prompt: intent } },
    };
  };
}
