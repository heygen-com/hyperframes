#!/usr/bin/env python3
"""
Filler word remover: transcribes a video with Whisper, detects filler words,
cuts them out with FFmpeg, and outputs a clean video file.

Usage:
    python remove_fillers.py input.mp4 [output.mp4] [--fillers um,uh,like] [--model small]
    python remove_fillers.py input.mp4 --dry-run    # preview cuts only

Requirements:
    pip install openai-whisper ffmpeg-python
    ffmpeg must be on PATH
"""

import argparse
import json
import subprocess
import sys
import os
import tempfile
from pathlib import Path

DEFAULT_FILLERS = {
    "um", "uh", "umm", "uhh", "hmm", "hm", "er", "err",
    "ah", "ahh", "like", "basically", "literally",
    "you know", "i mean", "so basically", "kind of", "sort of",
}

SILENCE_PAD = 0.05  # seconds to keep around cuts (avoids audio pops)


def transcribe(video_path: str, model_name: str) -> list[dict]:
    """Run Whisper and return word-level segments."""
    try:
        import whisper
    except ImportError:
        sys.exit("Install whisper: pip install openai-whisper")

    print(f"[transcribe] Loading Whisper model '{model_name}'...")
    model = whisper.load_model(model_name)

    print(f"[transcribe] Transcribing {video_path}...")
    result = model.transcribe(video_path, word_timestamps=True)

    words = []
    for segment in result.get("segments", []):
        for w in segment.get("words", []):
            words.append({
                "text": w["word"].strip().lower().strip(".,!?;:"),
                "start": w["start"],
                "end": w["end"],
            })

    print(f"[transcribe] Found {len(words)} words")
    return words


def find_filler_ranges(words: list[dict], fillers: set[str]) -> list[tuple[float, float]]:
    """Return list of (start, end) time ranges to cut."""
    cuts = []
    i = 0
    while i < len(words):
        # Check two-word phrases first
        if i + 1 < len(words):
            phrase = words[i]["text"] + " " + words[i + 1]["text"]
            if phrase in fillers:
                cuts.append((
                    max(0, words[i]["start"] - SILENCE_PAD),
                    words[i + 1]["end"] + SILENCE_PAD
                ))
                i += 2
                continue
        # Single word
        if words[i]["text"] in fillers:
            cuts.append((
                max(0, words[i]["start"] - SILENCE_PAD),
                words[i]["end"] + SILENCE_PAD
            ))
        i += 1

    # Merge overlapping ranges
    if not cuts:
        return []
    cuts.sort()
    merged = [cuts[0]]
    for start, end in cuts[1:]:
        if start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def build_keep_segments(cuts: list[tuple[float, float]], total_duration: float) -> list[tuple[float, float]]:
    """Invert cut ranges to get the segments we keep."""
    keep = []
    prev = 0.0
    for cut_start, cut_end in cuts:
        if cut_start > prev:
            keep.append((prev, cut_start))
        prev = cut_end
    if prev < total_duration:
        keep.append((prev, total_duration))
    return keep


def get_duration(video_path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", video_path],
        capture_output=True, text=True
    )
    return float(result.stdout.strip())


def cut_and_join(video_path: str, keep_segments: list[tuple[float, float]], output_path: str):
    """Use FFmpeg to cut keep segments and concatenate them."""
    print(f"[ffmpeg] Cutting {len(keep_segments)} segments...")

    with tempfile.TemporaryDirectory() as tmpdir:
        segment_files = []
        concat_list = os.path.join(tmpdir, "concat.txt")

        for i, (start, end) in enumerate(keep_segments):
            seg_path = os.path.join(tmpdir, f"seg_{i:04d}.mp4")
            duration = end - start
            subprocess.run([
                "ffmpeg", "-y",
                "-ss", str(start),
                "-i", video_path,
                "-t", str(duration),
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-c:a", "aac", "-b:a", "192k",
                "-avoid_negative_ts", "make_zero",
                seg_path
            ], check=True, capture_output=True)
            segment_files.append(seg_path)

        with open(concat_list, "w") as f:
            for seg in segment_files:
                f.write(f"file '{seg}'\n")

        print(f"[ffmpeg] Concatenating into {output_path}...")
        subprocess.run([
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", concat_list,
            "-c", "copy",
            output_path
        ], check=True, capture_output=True)

    print(f"[done] Output: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Remove filler words from video")
    parser.add_argument("input", help="Input video file")
    parser.add_argument("output", nargs="?", help="Output video file (default: input_clean.mp4)")
    parser.add_argument("--fillers", help="Comma-separated filler words/phrases to remove")
    parser.add_argument("--model", default="small", help="Whisper model (tiny/base/small/medium/large-v3)")
    parser.add_argument("--dry-run", action="store_true", help="Print cuts without writing video")
    parser.add_argument("--save-transcript", metavar="FILE", help="Save transcript JSON to file")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        sys.exit(f"File not found: {args.input}")

    fillers = DEFAULT_FILLERS
    if args.fillers:
        fillers = set(f.strip().lower() for f in args.fillers.split(","))

    output = args.output or Path(args.input).stem + "_clean.mp4"

    words = transcribe(args.input, args.model)

    if args.save_transcript:
        with open(args.save_transcript, "w") as f:
            json.dump(words, f, indent=2)
        print(f"[transcript] Saved to {args.save_transcript}")

    cuts = find_filler_ranges(words, fillers)
    print(f"\n[fillers] Found {len(cuts)} filler segments to remove:")
    total_cut = 0.0
    for i, (start, end) in enumerate(cuts):
        duration = end - start
        total_cut += duration
        # find the word(s) in this range
        in_range = [w["text"] for w in words if w["start"] >= start - SILENCE_PAD and w["end"] <= end + SILENCE_PAD]
        print(f"  {i+1:3d}. {start:.2f}s – {end:.2f}s ({duration:.2f}s)  [{', '.join(in_range)}]")

    print(f"\n[summary] Removing {total_cut:.1f}s of filler ({len(cuts)} cuts)")

    if args.dry_run:
        print("[dry-run] No file written.")
        return

    if not cuts:
        print("[skip] No fillers detected — nothing to cut.")
        return

    total_duration = get_duration(args.input)
    keep = build_keep_segments(cuts, total_duration)
    cut_and_join(args.input, keep, output)


if __name__ == "__main__":
    main()
