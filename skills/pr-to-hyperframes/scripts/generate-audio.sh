#!/bin/bash
# generate-audio.sh — Generate walkthrough narration audio from a JSON script.
#
# Generates one TTS call per segment, producing individual WAV clips directly.
# No chunking, alignment, or splitting needed.
#
# Usage:
#   ./generate-audio.sh <script.json> [output-dir]
#
# Input JSON format:
#   {
#     "style": "Read in a calm, steady, professional tone...",
#     "voice": "Iapetus",           (optional, default: Iapetus)
#     "slides": [
#       "Intro narration text...",
#       "Problem slide narration...",
#       "Approach narration...",
#       ...
#     ]
#   }
#
# Output:
#   <output-dir>/audio-00.wav, audio-01.wav, ...
#   <output-dir>/durations.json
#
# Dependencies:
#   ffmpeg / ffprobe
#
# Environment:
#   GEMINI_API_KEY — required. Auto-sourced from .env if not set.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Args ---
SCRIPT_JSON="${1:?Usage: generate-audio.sh <script.json> [output-dir]}"
OUTPUT_DIR="${2:-.}"

# Resolve relative paths
[[ "$SCRIPT_JSON" != /* ]] && SCRIPT_JSON="$(pwd)/$SCRIPT_JSON"
[[ "$OUTPUT_DIR" != /* ]] && OUTPUT_DIR="$(pwd)/$OUTPUT_DIR"

if [ ! -f "$SCRIPT_JSON" ]; then
  echo "Error: ${SCRIPT_JSON} not found"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

PYTHON="python3"

# --- API key ---
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")

if [ -z "${GEMINI_API_KEY:-}" ]; then
  if [ -f "${REPO_ROOT}/.env" ]; then
    export $(grep '^GEMINI_API_KEY=' "${REPO_ROOT}/.env" | xargs) 2>/dev/null || true
  fi
fi
GEMINI_API_KEY="${GEMINI_API_KEY:?Set GEMINI_API_KEY environment variable or add it to .env}"

# --- Config ---
TTS_MODEL="gemini-2.5-pro-preview-tts"
TTS_ENDPOINT="https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent"
SPEED=1.2

# --- Run everything in Python for reliability ---
"$PYTHON" - "$SCRIPT_JSON" "$OUTPUT_DIR" "$GEMINI_API_KEY" "$TTS_MODEL" "$TTS_ENDPOINT" "$SPEED" <<'PYTHON_SCRIPT'
import json, sys, os, subprocess, base64, urllib.request, re

script_json = sys.argv[1]
output_dir = sys.argv[2]
api_key = sys.argv[3]
tts_model = sys.argv[4]
tts_endpoint = sys.argv[5]
speed = float(sys.argv[6])

MAX_RETRIES = 2

def api_call(endpoint, body_dict):
    body = json.dumps(body_dict).encode()
    req = urllib.request.Request(
        f"{endpoint}?key={api_key}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

# --- Load narration ---
with open(script_json) as f:
    data = json.load(f)

voice = data.get("voice", "Iapetus")
slides = data["slides"]
style = data.get("style",
    "Read the following in a calm, steady, professional tone. "
    "Speak at a measured pace.")

word_count = sum(len(s.split()) for s in slides)
print(f"=== Generating narration audio ===")
print(f"  Voice: {voice}")
print(f"  Slides: {len(slides)}")
print(f"  Words: {word_count}")
print()

def call_tts(prompt_text):
    response = api_call(tts_endpoint, {
        "contents": [{"parts": [{"text": prompt_text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice
                    }
                }
            }
        }
    })

    error_msg = response.get("error", {}).get("message", "")
    if error_msg:
        raise RuntimeError(f"TTS API error: {error_msg}")

    return base64.b64decode(response["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])

def pcm_to_wav(pcm_bytes, out_wav):
    pcm_tmp = out_wav + ".pcm"
    with open(pcm_tmp, "wb") as f:
        f.write(pcm_bytes)
    subprocess.run([
        "ffmpeg", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1",
        "-i", pcm_tmp, "-af", f"atempo={speed}", "-ar", "48000", out_wav
    ], capture_output=True, check=True)
    os.remove(pcm_tmp)

def get_duration(wav_path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav_path],
        capture_output=True, text=True
    )
    return float(result.stdout.strip())

def validate_duration(wav_path, word_count):
    dur = get_duration(wav_path)
    expected = word_count / 150 * 60 / speed
    lower = expected * 0.3
    upper = expected * 3.0
    if word_count < 15:
        return dur < 30, dur
    return lower <= dur <= upper, dur

# --- Generate one TTS call per segment ---
durations = {}

for i, text in enumerate(slides):
    num = f"{i:02d}"
    out_path = os.path.join(output_dir, f"audio-{num}.wav")
    wc = len(text.split())
    prompt = f"{style}\n\n{text}"

    ok = False
    for attempt in range(MAX_RETRIES + 1):
        try:
            label = f"  [{num}] " + ("" if attempt == 0 else f"(retry {attempt}) ")
            print(f"{label}Generating ({wc} words)...", end=" ", flush=True)
            pcm_data = call_tts(prompt)
            pcm_to_wav(pcm_data, out_path)
            ok, dur = validate_duration(out_path, wc)
            if ok:
                print(f"{dur:.1f}s")
                durations[f"audio-{num}.wav"] = round(dur, 2)
                break
            else:
                expected = wc / 150 * 60 / speed
                print(f"{dur:.1f}s (expected ~{expected:.0f}s, retrying)")
        except (urllib.error.HTTPError, RuntimeError) as e:
            print(f"error: {e}")
            if attempt == MAX_RETRIES:
                print(f"  [error] Segment {i} failed after {MAX_RETRIES + 1} attempts")
                sys.exit(1)

    if not ok:
        dur = get_duration(out_path)
        durations[f"audio-{num}.wav"] = round(dur, 2)
        print(f"  [warn] Segment {i} audio may be unreliable ({dur:.1f}s for {wc} words)")

# --- Trim silence from each clip ---
MAX_SILENCE = 0.15
SILENCE_THRESHOLD = "-40dB"
print()
print("=== Trimming silence ===")

for i in range(len(slides)):
    num = f"{i:02d}"
    clip_path = os.path.join(output_dir, f"audio-{num}.wav")

    detect = subprocess.run([
        "ffmpeg", "-i", clip_path, "-af",
        f"silencedetect=noise={SILENCE_THRESHOLD}:d=0.1",
        "-f", "null", "-"
    ], capture_output=True, text=True)
    stderr = detect.stderr

    clip_dur = get_duration(clip_path)

    silence_starts = re.findall(r'silence_start: ([\d.]+)', stderr)
    silence_ends = re.findall(r'silence_end: ([\d.]+)', stderr)

    trim_start = 0.0
    if silence_starts and float(silence_starts[0]) < 0.05:
        if silence_ends:
            leading_silence = float(silence_ends[0])
            if leading_silence > MAX_SILENCE:
                trim_start = leading_silence - MAX_SILENCE

    trim_end = clip_dur
    is_last = (i == len(slides) - 1)
    if not is_last and silence_starts:
        last_silence_start = float(silence_starts[-1])
        last_silence_is_trailing = True
        for se in silence_ends:
            se_val = float(se)
            if se_val > last_silence_start and se_val < clip_dur - 0.05:
                last_silence_is_trailing = False
                break
        if last_silence_is_trailing and last_silence_start > 0.05:
            trailing_silence = clip_dur - last_silence_start
            if trailing_silence > MAX_SILENCE:
                trim_end = last_silence_start + MAX_SILENCE

    if trim_start > 0 or trim_end < clip_dur:
        trimmed_path = clip_path + ".tmp.wav"
        subprocess.run([
            "ffmpeg", "-y", "-i", clip_path,
            "-ss", str(trim_start), "-to", str(trim_end),
            "-c", "copy", trimmed_path
        ], capture_output=True)
        os.replace(trimmed_path, clip_path)
        new_dur = trim_end - trim_start
        durations[f"audio-{num}.wav"] = round(new_dur, 2)
        print(f"  audio-{num}.wav: {clip_dur:.1f}s -> {new_dur:.1f}s (trimmed {clip_dur - new_dur:.1f}s)")
    else:
        print(f"  audio-{num}.wav: {clip_dur:.1f}s (no trim needed)")

# --- Write durations.json ---
durations_path = os.path.join(output_dir, "durations.json")
with open(durations_path, "w") as f:
    json.dump(durations, f, indent=2)

total_dur = sum(durations.values())
print(f"\n  Wrote durations.json ({len(durations)} entries, {total_dur:.1f}s total)")

print()
print("=== Done ===")
PYTHON_SCRIPT

echo ""
echo "Output:"
ls -la "${OUTPUT_DIR}"/audio-*.wav 2>/dev/null || echo "  (no files generated)"
