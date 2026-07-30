// tts.mjs — multi-provider TTS for the media audio engine. The provider chain,
// auto-detected from env, is the one documented in ../SKILL.md:
//
//   1. HeyGen (Starfish)  — $HEYGEN_API_KEY / $HYPERFRAMES_API_KEY / ~/.heygen.
//        Direct v3 REST (NOT `hyperframes tts`, which in the published build is
//        Kokoro-only and silently ignores a HeyGen key). Returns word_timestamps
//        in the same call, so no separate transcribe pass.
//   2. ElevenLabs         — $ELEVENLABS_API_KEY + `pip install elevenlabs`. No
//        word timings → caller chains transcribeWav().
//   3. Kokoro-82M (local) — via the published `hyperframes tts` CLI. No word
//        timings → caller chains transcribeWav().
//   4. Edge TTS (CLI)     — no key or ML deps. Native WordBoundary timings
//        from --write-subtitles, so no transcribe pass.
//
// "HeyGen available" is decided by CREDENTIAL presence (heygenCredential), never
// by the CLI — see the note above.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { heygenAuthHeaders, heygenCredential, heygenJSON } from "./heygen.mjs";
import { pythonInvocation } from "./python.mjs";

// ── provider detection ────────────────────────────────────────────────────────
export function heygenAvailable() {
  return heygenCredential() !== null;
}
export function elevenlabsAvailable() {
  if (!process.env.ELEVENLABS_API_KEY) return false;
  const { cmd, args } = pythonInvocation(["-c", "import elevenlabs"]);
  const r = spawnSync(cmd, args, {
    stdio: "ignore",
  });
  return r.status === 0;
}
export function kokoroAvailable(spawnSyncFn = spawnSync) {
  const { cmd, args } = pythonInvocation(["-c", "import kokoro_onnx, soundfile"]);
  const r = spawnSyncFn(cmd, args, { stdio: "ignore" });
  return r.status === 0;
}
export function edgeAvailable(spawnSyncFn = spawnSync) {
  const r = spawnSyncFn("edge-tts", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

// First available provider wins; an explicit choice is honored (and validated).
export function pickProvider(userProvider, deps = {}) {
  const hasHeygen = deps.heygenAvailable ?? heygenAvailable;
  const hasElevenlabs = deps.elevenlabsAvailable ?? elevenlabsAvailable;
  const hasKokoro = deps.kokoroAvailable ?? kokoroAvailable;
  const hasEdge = deps.edgeAvailable ?? edgeAvailable;
  if (userProvider) {
    if (!["heygen", "elevenlabs", "kokoro", "edge"].includes(userProvider))
      throw new Error(`invalid provider "${userProvider}" (heygen | elevenlabs | kokoro | edge)`);
    if (userProvider === "heygen" && !hasHeygen())
      throw new Error(
        "provider=heygen but no HeyGen credentials (set $HEYGEN_API_KEY or run `npx hyperframes auth login`)",
      );
    if (userProvider === "elevenlabs" && !process.env.ELEVENLABS_API_KEY)
      throw new Error("provider=elevenlabs but $ELEVENLABS_API_KEY is not set");
    if (userProvider === "edge" && !hasEdge())
      throw new Error(
        "provider=edge but edge-tts is not installed (install with `pipx install edge-tts` or `pip install edge-tts`)",
      );
    return userProvider;
  }
  if (hasHeygen()) return "heygen";
  if (hasElevenlabs()) return "elevenlabs";
  if (hasKokoro()) return "kokoro";
  if (hasEdge()) return "edge";
  // Preserve the existing terminal behavior when no provider can be proven
  // available: Kokoro will surface its established install diagnostic.
  return "kokoro";
}

// ── voice resolution ──────────────────────────────────────────────────────────
// HeyGen /v3/voices/speech only accepts STARFISH voice_ids; auto-pick the first
// English public starfish voice when none is pinned. ElevenLabs/Kokoro have
// their own defaults.
export async function resolveVoiceId({ provider, userVoice, lang = "en" }) {
  if (userVoice) return userVoice;
  if (provider === "elevenlabs") return "21m00Tcm4TlvDq8ikWAM"; // Rachel
  if (provider === "edge") return "en-US-AndrewNeural";
  if (provider === "kokoro") {
    if (lang === "en") return "am_michael";
    throw new Error("Kokoro non-English needs an explicit --voice (see references/tts.md)");
  }
  // heygen — pin a fixed English default so the choice is deterministic. The old
  // "first English voice the API returns" drifts whenever HeyGen re-sorts the
  // public catalog. Marcia (mature, low female). Override with --voice / request.voice.
  if (lang === "en") return "05f19352e8f74b0392a8f411eba40de1"; // Marcia · English · female
  // Non-English: no fixed default — fall back to the first matching catalog voice.
  const payload = await heygenJSON(`/voices?engine=starfish&type=public&limit=50`, {
    headers: heygenAuthHeaders(),
  });
  const voices = payload.data ?? payload.voices ?? [];
  const pick = voices.find((v) => v.language === "English") ?? voices[0];
  if (!pick) throw new Error("no public starfish voice to default to — pass --voice");
  return pick.voice_id;
}

// ── helpers ─────────────────────────────────────────────────────────────────
export function withWordIds(words) {
  return (words ?? []).map((w, i) => ({
    id: `w${i}`,
    text: w.text,
    start: w.start,
    end: w.end,
  }));
}

function parseVttTimestampMs(value) {
  const parts = String(value).replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3) return NaN;
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return NaN;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

// edge-tts emits one WordBoundary cue per VTT block. The engine's public timing
// contract is seconds, so parse at millisecond precision and normalize here.
export function parseEdgeVtt(vttText) {
  const words = [];
  for (const block of String(vttText ?? "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trim());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const match =
      /^(\d{2}:\d{2}(?::\d{2})?[.,]\d{3})\s+-->\s+(\d{2}:\d{2}(?::\d{2})?[.,]\d{3})(?:\s+.*)?$/.exec(
        lines[timingIndex],
      );
    if (!match) continue;
    const startMs = parseVttTimestampMs(match[1]);
    const endMs = parseVttTimestampMs(match[2]);
    const text = lines
      .slice(timingIndex + 1)
      .filter(Boolean)
      .join(" ");
    if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    words.push({ text, start: startMs / 1000, end: endMs / 1000 });
  }
  return words;
}

export function edgeRate(speed) {
  if (typeof speed === "string" && /^[+-]?\d+(?:\.\d+)?%$/.test(speed.trim())) {
    const rate = speed.trim();
    return /^[+-]/.test(rate) ? rate : `+${rate}`;
  }
  const numeric = Number(speed);
  if (!Number.isFinite(numeric) || numeric === 1) return "-2%";
  const percent = Math.round((numeric - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

// `ffmpeg -i <file>` prints a `Duration: HH:MM:SS.ms` line to stderr even
// though it exits non-zero with no output requested. Parsing pulled out as
// a pure function so the ENOENT fallback below can be tested without
// depending on whether ffprobe/ffmpeg are actually installed on the
// machine running the tests.
export function parseFfmpegDurationBanner(stderrText) {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderrText ?? "");
  if (!match) return NaN;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

// Some "essentials"-style ffmpeg distributions (common on Windows) ship
// ffmpeg.exe without ffprobe.exe. ffprobeDuration's caller (audio.mjs)
// otherwise reads a spurious NaN as "the WAV file is corrupt" and drops an
// already-successfully-synthesized TTS line, rather than "the tool for
// measuring it is missing".
function ffmpegDurationFallback(absPath) {
  const r = spawnSync("ffmpeg", ["-i", absPath], { encoding: "utf8" });
  return parseFfmpegDurationBanner(r.stderr);
}

export function ffprobeDuration(absPath) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", absPath],
    { encoding: "utf8" },
  );
  if (r.error?.code === "ENOENT") return ffmpegDurationFallback(absPath);
  if (r.status !== 0) return NaN;
  return parseFloat(String(r.stdout).trim());
}

export function resolveNpxCliFromNpmExecPath(
  npmExecPath = process.env.npm_execpath,
  pathExists = existsSync,
) {
  if (!npmExecPath) return null;
  const fileName = npmExecPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
  const npxCliPath =
    fileName === "npx-cli.js" ? npmExecPath : join(dirname(npmExecPath), "npx-cli.js");
  return pathExists(npxCliPath) ? npxCliPath : null;
}

export function resolveNpxCliPath(
  npmExecPath = process.env.npm_execpath,
  nodeExecPath = process.env.npm_node_execpath || process.execPath,
  pathExists = existsSync,
) {
  const fromNpm = resolveNpxCliFromNpmExecPath(npmExecPath, pathExists);
  if (fromNpm) return fromNpm;
  const besideNode = join(dirname(nodeExecPath), "node_modules", "npm", "bin", "npx-cli.js");
  return pathExists(besideNode) ? besideNode : null;
}

export function resolveSpawnCommand(
  cmd,
  args,
  opts = {},
  platform = process.platform,
  env = process.env,
  pathExists = existsSync,
) {
  if (cmd !== "npx" || platform !== "win32") {
    return { cmd, args, opts: { stdio: "ignore", ...opts } };
  }

  // On Windows, npx resolves to npx.cmd, which Node cannot execute directly.
  // Avoid `shell:true` and the .cmd shim entirely by invoking npm's JS CLI with
  // node, preserving request-provided values as argv data instead of shell text.
  const nodeExecPath = env.npm_node_execpath || process.execPath;
  const npxCliPath = resolveNpxCliPath(env.npm_execpath, nodeExecPath, pathExists);
  if (!npxCliPath) return null;
  return {
    cmd: nodeExecPath,
    args: [npxCliPath, ...args.map((arg) => String(arg))],
    opts: { stdio: "ignore", windowsHide: true, ...opts },
  };
}

// `platform`/`spawnFn` params (default process.platform / the real spawn)
// exist so tests can exercise the win32 branch without mocking node:child_process
// (its ESM exports are non-configurable, so mock.method can't patch it).
// One-shot so a whole batch of TTS lines doesn't repeat the same diagnostic.
let _warnedNpxResolution = false;
/** Test-only: reset the one-shot npx-resolution warning latch. */
export function _resetNpxResolutionWarnForTests() {
  _warnedNpxResolution = false;
}

export function spawnP(
  cmd,
  args,
  opts = {},
  platform = process.platform,
  spawnFn = spawn,
  env = process.env,
  pathExists = existsSync,
) {
  const resolved = resolveSpawnCommand(cmd, args, opts, platform, env, pathExists);
  if (!resolved) {
    // resolveSpawnCommand only returns null for the npx-on-win32 case where
    // neither npm's configured CLI nor the beside-node fallback exists. Without
    // this, every call silently returns status:-1 and stdio:"ignore" hides why.
    if (!_warnedNpxResolution) {
      _warnedNpxResolution = true;
      const reason = env.npm_execpath
        ? `npm_execpath (${env.npm_execpath}) and the beside-node npm fallback could not be found`
        : "npm_execpath is unset and the beside-node npm fallback could not be found";
      console.error(
        `[media-use] Cannot run "${cmd}" on Windows: ${reason}. ` +
          `Every "${cmd}" call is being skipped. Install npm with Node, or run via ` +
          `\`npx\`/\`npm run\` with a valid npm_execpath.`,
      );
    }
    return Promise.resolve({ status: -1 });
  }
  return new Promise((resolve) => {
    const p = spawnFn(resolved.cmd, resolved.args, resolved.opts);
    p.on("exit", (code) => resolve({ status: code ?? -1 }));
    p.on("error", () => resolve({ status: -1 }));
  });
}

// mp3/whatever bytes → wav 44.1k mono at destWav (ffmpeg detects true format).
function transcodeToWav(bytes, destWav) {
  const td = mkdtempSync(join(tmpdir(), "hf-tts-"));
  const tmp = join(td, "a.mp3");
  writeFileSync(tmp, bytes);
  mkdirSync(dirname(destWav), { recursive: true });
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", tmp, "-ar", "44100", "-ac", "1", destWav],
    { stdio: "ignore" },
  );
  rmSync(td, { recursive: true, force: true });
  return ff.status === 0 && existsSync(destWav);
}

const ELEVENLABS_PY = `
import os, sys
from elevenlabs.client import ElevenLabs
from elevenlabs import save
client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
text = open(sys.argv[1]).read()
audio = client.text_to_speech.convert(
    text=text, voice_id=sys.argv[2],
    model_id="eleven_multilingual_v2", output_format="mp3_44100_128",
)
save(audio, sys.argv[3])
`;

// ── synthesize one line ───────────────────────────────────────────────────────
// Writes wav at wavAbs. Returns { ok, words, error } — words is the raw
// [{text,start,end}] array for HeyGen/Edge (native), or null for ElevenLabs/
// Kokoro (caller must transcribeWav). Never throws; failures return { ok:false, error }
// where `error` states WHY (so the caller can surface it, not a bare "TTS failed").
export async function synthesizeOne({
  provider,
  text,
  voiceId,
  lang = "en",
  speed = 1.0,
  wavAbs,
  hyperframesDir,
}) {
  if (provider === "heygen") return synthesizeHeygen({ text, voiceId, lang, speed, wavAbs });
  if (provider === "edge") return synthesizeEdge({ text, voiceId, speed, wavAbs });
  if (provider === "elevenlabs") {
    // The Python helper writes straight to wavAbs; unlike heygen (transcodeToWav)
    // and kokoro (the `hyperframes tts` CLI), it does NOT create the parent dir,
    // so on a fresh project (no assets/voice/ yet) the save fails and the line is
    // silently dropped as "TTS failed - omitted". Create it first, like the other
    // providers do. Guarded so a mkdir failure (EACCES/EROFS) returns
    // { ok:false } like the rest of this branch rather than throwing (the
    // function's contract is "never throws; failures return { ok:false }").
    try {
      mkdirSync(dirname(wavAbs), { recursive: true });
    } catch {
      return { ok: false, words: null };
    }
    const { cmd, args } = pythonInvocation([
      "-c",
      ELEVENLABS_PY,
      writeTmpText(text),
      voiceId,
      wavAbs,
    ]);
    const r = await spawnP(cmd, args, {});
    return synthResult(r, wavAbs, "elevenlabs (python)");
  }
  // kokoro — via the published CLI; --output is relative to the project dir.
  const wavRel = relTo(hyperframesDir, wavAbs);
  const args = ["hyperframes", "tts", writeTmpText(text), "--voice", voiceId, "--output", wavRel];
  if (lang !== "en") args.push("--lang", lang);
  const r = await spawnP("npx", args, { cwd: hyperframesDir });
  return synthResult(r, wavAbs, "kokoro (npx hyperframes tts)");
}

// Shape a spawn result into { ok, words, error }, naming why on failure so the
// caller surfaces it instead of a bare "TTS failed".
export function synthResult(r, wavAbs, label) {
  if (r.status === 0 && existsSync(wavAbs)) return { ok: true, words: null };
  const why =
    r.status !== 0 ? `${label} exited with status ${r.status}` : `${label} produced no wav file`;
  return { ok: false, words: null, error: why };
}

export async function synthesizeEdge({ text, voiceId, speed, wavAbs }, deps = {}) {
  const run = deps.spawnP ?? spawnP;
  const transcode = deps.transcodeToWav ?? transcodeToWav;
  const probeDuration = deps.ffprobeDuration ?? ffprobeDuration;
  const td = mkdtempSync(join(tmpdir(), "hf-edge-tts-"));
  const mp3 = join(td, "voice.mp3");
  const vtt = join(td, "words.vtt");
  try {
    const r = await run("edge-tts", [
      "--voice",
      voiceId,
      `--rate=${edgeRate(speed)}`,
      "--text",
      text,
      "--write-media",
      mp3,
      "--write-subtitles",
      vtt,
    ]);
    if (r.status !== 0) {
      return { ok: false, words: null, error: `edge-tts exited with status ${r.status}` };
    }
    if (!existsSync(mp3) || !existsSync(vtt)) {
      return { ok: false, words: null, error: "edge-tts produced no media or subtitles" };
    }
    if (!transcode(readFileSync(mp3), wavAbs)) {
      return { ok: false, words: null, error: "edge-tts wav transcode failed (ffmpeg)" };
    }
    const duration = probeDuration(wavAbs);
    if (!Number.isFinite(duration) || duration <= 0) {
      return { ok: false, words: null, error: "edge-tts produced unreadable audio duration" };
    }
    return { ok: true, words: parseEdgeVtt(readFileSync(vtt, "utf8")) };
  } catch (e) {
    return { ok: false, words: null, error: e?.message ? String(e.message) : String(e) };
  } finally {
    rmSync(td, { recursive: true, force: true });
  }
}

// `deps` is injectable for tests; production uses the real network/ffmpeg impls.
// Every failure path returns an `error` string so the caller can surface WHY a
// line was dropped instead of the bare "TTS failed" that hid the real cause
// (e.g. an HTTP 402 plan_upgrade_required thrown by heygenJSON was swallowed).
export async function synthesizeHeygen({ text, voiceId, lang, speed, wavAbs }, deps = {}) {
  const requestJSON = deps.heygenJSON ?? heygenJSON;
  const authHeaders = deps.heygenAuthHeaders ?? heygenAuthHeaders;
  const fetchImpl = deps.fetch ?? fetch;
  const transcode = deps.transcodeToWav ?? transcodeToWav;
  try {
    const body = { text, voice_id: voiceId, speed };
    if (lang !== "en") body.language = lang;
    const payload = await requestJSON(`/voices/speech`, {
      method: "POST",
      headers: authHeaders(),
      body,
    });
    const inner = payload.data ?? payload;
    if (!inner.audio_url) {
      return { ok: false, words: null, error: "HeyGen /voices/speech returned no audio_url" };
    }
    const res = await fetchImpl(inner.audio_url);
    if (!res.ok) {
      return { ok: false, words: null, error: `audio_url fetch failed: HTTP ${res.status}` };
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    // .wav output → transcode to 44.1k mono; .mp3 → raw bytes (no ffmpeg). The
    // engine always asks for .wav; the standalone heygen-tts CLI may ask for .mp3.
    if (wavAbs.endsWith(".wav")) {
      if (!transcode(bytes, wavAbs)) {
        return {
          ok: false,
          words: null,
          error: "wav transcode failed (ffmpeg)",
        };
      }
    } else {
      mkdirSync(dirname(wavAbs), { recursive: true });
      writeFileSync(wavAbs, bytes);
    }
    const words = Array.isArray(inner.word_timestamps)
      ? inner.word_timestamps
          .filter((w) => w && typeof w.word === "string" && isFinite(w.start) && isFinite(w.end))
          .filter((w) => !/^<.*>$/.test(w.word.trim())) // drop <start>/<end> sentinels
          .map((w) => ({ text: w.word, start: w.start, end: w.end }))
      : [];
    return { ok: true, words };
  } catch (e) {
    return { ok: false, words: null, error: e?.message ? String(e.message) : String(e) };
  }
}

// ElevenLabs/Kokoro have no word timings — run Whisper over the wav. Returns the
// flat [{id,text,start,end}] word array, or null. Each call uses a throwaway
// --dir so parallel scenes don't collide on transcript.json.
export async function transcribeWav({ wavRel, lang = "en", hyperframesDir }) {
  const model = lang === "en" ? "small.en" : "small";
  const td = mkdtempSync(join(tmpdir(), "hf-trans-"));
  const args = ["hyperframes", "transcribe", wavRel, "--model", model, "--dir", td];
  if (lang !== "en") args.push("--language", lang);
  const r = await spawnP("npx", args, { cwd: hyperframesDir });
  let words = null;
  if (r.status === 0) {
    const src = join(td, "transcript.json");
    if (existsSync(src)) {
      try {
        const arr = JSON.parse(readFileSync(src, "utf8"));
        if (Array.isArray(arr) && arr.length) words = arr;
      } catch {}
    }
  }
  rmSync(td, { recursive: true, force: true });
  return words;
}

// ── tiny local utils ──────────────────────────────────────────────────────────
function writeTmpText(text) {
  const td = mkdtempSync(join(tmpdir(), "hf-txt-"));
  const p = join(td, "line.txt");
  writeFileSync(p, text);
  return p;
}
function relTo(base, abs) {
  return abs.startsWith(base + "/") ? abs.slice(base.length + 1) : abs;
}
