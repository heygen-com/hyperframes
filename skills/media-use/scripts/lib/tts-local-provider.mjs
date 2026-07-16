import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSpawnCommand } from "../../audio/scripts/lib/tts.mjs";

// Local voiceover via the packaged Kokoro-82M TTS (the `hyperframes tts` CLI),
// the free/private default now that HeyGen TTS costs wallet credits. Kokoro runs
// on-device (CPU, faster-than-realtime, bundled voices, native word timestamps),
// so no key and no per-call charge. When Kokoro is not set up, this returns null
// and the registry falls through to the HeyGen TTS upsell.
//
// Delegated to the hyperframes CLI (same as transcribe / remove-background), not
// re-implemented here. ffprobe reads the duration back for the ledger.

function probeDurationSeconds(file) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { encoding: "utf8", timeout: 15000 },
    );
    const d = parseFloat(String(out).trim());
    return Number.isFinite(d) ? d : undefined;
  } catch {
    return undefined;
  }
}

// `platform`/`execFn`/`env`/`pathExists` params (defaulting to the real
// values) exist so tests can exercise the win32 branch without mocking
// node:child_process (its ESM exports are non-configurable) — same idiom as
// spawnP in ../../audio/scripts/lib/tts.mjs.
export async function localTtsGenerate(
  intent,
  ctx,
  platform = process.platform,
  execFn = execFileSync,
  env = process.env,
  pathExists = existsSync,
) {
  const outPath = join(tmpdir(), `media-use-kokoro-${process.pid}-${Date.now()}.wav`);
  const argv = ["hyperframes", "tts", intent, "--output", outPath];
  if (ctx?.voice) argv.push("--voice", ctx.voice);
  if (ctx?.lang && ctx.lang !== "en") argv.push("--lang", ctx.lang);
  // On Windows a bare "npx" is npx.cmd, which execFileSync cannot exec
  // (spawnSync npx ENOENT) — resolveSpawnCommand reroutes it through
  // node + npx-cli.js, same as the audio engine's TTS spawns.
  const resolved = resolveSpawnCommand(
    "npx",
    argv,
    { encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "pipe"] },
    platform,
    env,
    pathExists,
  );
  if (!resolved) {
    // npx-on-win32 with no resolvable npx-cli.js — same terminal condition
    // spawnP warns about. Fall through to the next provider rather than crash.
    console.error(
      "media-use: local voice not enabled (kokoro). Cannot run npx on Windows: " +
        "npm's npx-cli.js was not found (install npm with Node, or run via npx/npm run so npm_execpath is set).",
    );
    return null;
  }
  try {
    execFn(resolved.cmd, resolved.args, resolved.opts);
  } catch (err) {
    // `hyperframes tts` prints its "kokoro-onnx not installed" hint to stdout
    // (clack UI), so read both streams and surface the actionable enable-command
    // rather than a bare "Command failed": otherwise resolve silently falls
    // through to the PAID HeyGen TTS upsell when free local voice was one pip away.
    const out = `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`.trim();
    const hint = /not installed|pip install kokoro/i.test(out)
      ? "install for free on-device voice: pip install kokoro-onnx soundfile (or set HYPERFRAMES_PYTHON to a venv that has it)"
      : out.slice(-200) || err.message;
    console.error(`media-use: local voice not enabled (kokoro). ${hint}`);
    return null;
  }
  if (!existsSync(outPath) || statSync(outPath).size === 0) return null;
  return {
    localPath: outPath,
    ext: ".wav",
    source: "generated",
    metadata: {
      description: intent,
      provider: "kokoro.local",
      duration: probeDurationSeconds(outPath),
      provenance: { engine: "kokoro-82m", prompt: intent },
    },
  };
}
