import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

export async function localTtsGenerate(intent, ctx) {
  const outPath = join(tmpdir(), `media-use-kokoro-${process.pid}-${Date.now()}.wav`);
  const argv = ["hyperframes", "tts", intent, "--output", outPath];
  if (ctx?.voice) argv.push("--voice", ctx.voice);
  if (ctx?.lang && ctx.lang !== "en") argv.push("--lang", ctx.lang);
  try {
    execFileSync("npx", argv, {
      encoding: "utf8",
      timeout: 300000,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
