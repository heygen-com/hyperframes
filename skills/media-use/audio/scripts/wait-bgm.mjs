#!/usr/bin/env node
// Phase 4c pre-assemble helper — wait for detached BGM, then write status.
//
// audio.mjs may launch Lyria / MusicGen in a detached process so voice work can
// keep moving. Before assemble-index.mjs decides whether to emit the BGM audio
// track, this script gives the background renderer a bounded chance to finish
// and converts log/process state into a small bgm_status.json file.
//
// Always exits 0 for normal pipeline use: missing/failed BGM should not block a
// voice/captions/SFX render. Structural invocation errors still exit 1.
//
// Usage:
//   node wait-bgm.mjs --audio-meta ./audio_meta.json --hyperframes . \
//     [--timeout-ms 120000] [--interval-ms 2000] [--out ./bgm_status.json]

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { replaceFile } from "../../scripts/lib/manifest.mjs";
import { recordInManifest } from "./lib/media-record.mjs";
import { engineBgmLog, projectPath } from "./lib/project-path.mjs";
import { terminalText } from "../../scripts/lib/terminal-text.mjs";

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};

function die(msg) {
  console.error(`✗ wait-bgm.mjs: ${msg}`.split("\n").map(terminalText).join("\n"));
  process.exit(1);
}

const audioMetaPath = resolve(flag("audio-meta", "./audio_meta.json"));
const hyperframesDir = resolve(flag("hyperframes", "."));
const outPath = resolve(flag("out", join(hyperframesDir, "bgm_status.json")));
const timeoutMs = Math.max(0, Number(flag("timeout-ms", "120000")) || 0);
const intervalMs = Math.max(250, Number(flag("interval-ms", "2000")) || 2000);

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isProcessAlive(pid) {
  if (!pid || !Number.isFinite(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function readTail(path, maxChars = 6000) {
  if (!path) return "";
  try {
    const txt = readFileSync(path, "utf8");
    return txt.slice(Math.max(0, txt.length - maxChars));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return "";
    throw error;
  }
}

function detectFailure(logTail) {
  if (!logTail) return "";
  const lines = logTail.split("\n");
  // Bare "out of range" over-matched benign BGM-renderer logs (e.g. a "sample rate
  // out of range, resampling" notice), mislabelling a healthy track as failed and
  // silently dropping the music. Anchor to the actual crash strings instead:
  // Python "(list) index out of range" and torch "index … out of bounds".
  const idx = lines.findIndex((line) =>
    /(Traceback|IndexError|RuntimeError|Exception|Killed|No space left|Cannot allocate|index out of range|out of bounds)/i.test(
      line,
    ),
  );
  if (idx < 0) return "";
  return lines.slice(idx).join("\n").trim();
}

function writeStatus(status) {
  const payload = {
    generated_at: new Date().toISOString(),
    ...status,
  };
  // Renamed into place, so a link planted at the status file is replaced, never written through.
  replaceFile(outPath, JSON.stringify(payload, null, 2) + "\n");
  return payload;
}

if (!existsSync(audioMetaPath)) die(`audio_meta.json missing at ${audioMetaPath}`);

let audioMeta;
try {
  audioMeta = JSON.parse(readFileSync(audioMetaPath, "utf8"));
} catch (e) {
  die(`audio_meta.json parse: ${e.message}`);
}
// A track path that leads outside the project counts as no track.
const bgmAbsPath = (audioMeta.bgm?.path && projectPath(hyperframesDir, audioMeta.bgm.path)) || "";
const bgmPath = bgmAbsPath ? audioMeta.bgm.path : "";
// Only the engine's own log in assets/bgm is read; any other bgm_log counts as no log, and its pid goes with it.
const logPath = engineBgmLog(hyperframesDir, audioMeta.bgm_log) || "";
const pid = (logPath && audioMeta.bgm_pid) || null;

const base = {
  enabled: Boolean(audioMeta.bgm_pending && bgmPath),
  provider: audioMeta.bgm_provider || null,
  mode: audioMeta.bgm_mode || null,
  path: bgmPath || null,
  log: logPath || null,
  pid,
  target_duration_s: audioMeta.bgm_target_duration_s || null,
  seed_duration_s: audioMeta.bgm_seed_duration_s || null,
  loop_count: audioMeta.bgm_loop_count || null,
  timeout_ms: timeoutMs,
};

if (!base.enabled) {
  const status = writeStatus({
    ...base,
    status: "disabled",
    ready: false,
    waited_ms: 0,
    message: "BGM not requested or disabled in audio_meta.json.",
  });
  console.log(terminalText(`✓ bgm: ${status.status} (${status.message})`));
  process.exit(0);
}

const started = Date.now();
let lastFailure = "";
let lastTail = "";

while (Date.now() - started <= timeoutMs) {
  if (existsSync(bgmAbsPath)) {
    const size = statSync(bgmAbsPath).size;
    writeStatus({
      ...base,
      status: "ready",
      ready: true,
      waited_ms: Date.now() - started,
      size_bytes: size,
      message: `BGM ready at ${bgmPath}.`,
    });
    console.log(terminalText(`✓ bgm: ready (${bgmPath}, ${size}B)`));
    const generated = { path: bgmPath, type: "bgm", source: "generated", provider: base.provider };
    for (const anomaly of recordInManifest(hyperframesDir, [generated]))
      console.error(terminalText(`  ${anomaly}`));
    process.exit(0);
  }

  lastTail = readTail(logPath);
  lastFailure = detectFailure(lastTail);
  const alive = isProcessAlive(pid);
  if (lastFailure || (!alive && logPath && existsSync(logPath))) {
    const message = lastFailure
      ? `BGM renderer failed; see ${logPath}.`
      : `BGM renderer exited without writing ${bgmPath}; see ${logPath}.`;
    const status = writeStatus({
      ...base,
      status: "failed",
      ready: false,
      waited_ms: Date.now() - started,
      process_alive: alive,
      message,
      error_tail: (lastFailure || lastTail).slice(-2000),
    });
    console.log(terminalText(`! bgm: failed (${status.message})`));
    process.exit(0);
  }

  if (timeoutMs === 0) break;
  await sleep(Math.min(intervalMs, Math.max(0, timeoutMs - (Date.now() - started))));
}

const status = writeStatus({
  ...base,
  status: "timeout",
  ready: false,
  waited_ms: Date.now() - started,
  process_alive: isProcessAlive(pid),
  message: `Timed out waiting for ${bgmPath}; assemble-index will skip BGM if still absent.`,
  log_tail: lastTail.slice(-2000),
});
console.log(terminalText(`! bgm: timeout after ${status.waited_ms}ms (${bgmPath})`));
