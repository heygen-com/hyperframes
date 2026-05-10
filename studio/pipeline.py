#!/usr/bin/env python3
"""
Full video editing pipeline:
  1. Remove filler words from raw video
  2. Transcribe clean video for captions
  3. Scaffold a HyperFrames project with the clean video
  4. Render final video with motion graphics

Usage:
    python pipeline.py input.mp4 [--project my-video] [--model small] [--voice af_heart]
    python pipeline.py script.txt [--project my-video] [--voice af_heart]   # script → TTS → edit

Requirements:
    pip install openai-whisper ffmpeg-python
    bun (or npx) with hyperframes installed
    ffmpeg on PATH
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HYPERFRAMES = "npx hyperframes"


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd, check=True, **kwargs)


def pipeline_from_video(video_path: str, project_name: str, whisper_model: str, fillers: set[str]):
    """Pipeline: raw video → filler removal → HyperFrames project."""
    video = Path(video_path)
    clean_video = video.parent / (video.stem + "_clean.mp4")
    transcript_file = video.parent / "transcript.json"

    # Step 1: Remove fillers
    print("\n=== STEP 1: Remove filler words ===")
    run([sys.executable, "studio/remove_fillers.py",
         str(video), str(clean_video),
         "--model", whisper_model,
         "--save-transcript", str(transcript_file)])

    # Step 2: Scaffold HyperFrames project
    print("\n=== STEP 2: Scaffold HyperFrames project ===")
    run(HYPERFRAMES.split() + ["init", project_name,
        "--video", str(clean_video),
        "--non-interactive"])

    # Step 3: Copy transcript into project
    project_transcript = Path(project_name) / "transcript.json"
    shutil.copy(transcript_file, project_transcript)
    print(f"[pipeline] Transcript copied to {project_transcript}")

    print(f"""
=== PIPELINE READY ===

Project: ./{project_name}/
  index.html       ← Edit this to add motion graphics
  transcript.json  ← Word-level timestamps for captions
  {clean_video.name}    ← Filler-free video

Next steps:
  1. Edit ./{project_name}/index.html to add your motion graphics
     (ask Claude with: "add motion graphics to my composition")
  2. Preview:  {HYPERFRAMES} preview --cwd ./{project_name}
  3. Render:   {HYPERFRAMES} render --cwd ./{project_name} -o final.mp4
""")


def pipeline_from_script(script_path: str, project_name: str, voice: str):
    """Pipeline: script.txt → TTS → transcribe → HyperFrames project."""
    script = Path(script_path)
    audio_file = script.parent / "narration.wav"
    transcript_file = script.parent / "transcript.json"

    # Step 1: Generate TTS narration
    print("\n=== STEP 1: Generate TTS narration ===")
    run(HYPERFRAMES.split() + ["tts", str(script),
        "--voice", voice,
        "--output", str(audio_file)])

    # Step 2: Transcribe for captions
    print("\n=== STEP 2: Transcribe narration ===")
    run(HYPERFRAMES.split() + ["transcribe", str(audio_file)])
    # hyperframes transcribe writes transcript.json in cwd
    if not transcript_file.exists() and Path("transcript.json").exists():
        shutil.move("transcript.json", transcript_file)

    # Step 3: Scaffold HyperFrames project
    print("\n=== STEP 3: Scaffold HyperFrames project ===")
    run(HYPERFRAMES.split() + ["init", project_name,
        "--audio", str(audio_file),
        "--non-interactive"])

    # Step 4: Copy transcript into project
    project_transcript = Path(project_name) / "transcript.json"
    shutil.copy(transcript_file, project_transcript)
    print(f"[pipeline] Transcript copied to {project_transcript}")

    print(f"""
=== PIPELINE READY ===

Project: ./{project_name}/
  index.html       ← Edit this to add motion graphics
  transcript.json  ← Word-level timestamps for captions
  narration.wav    ← Generated voiceover

Next steps:
  1. Edit ./{project_name}/index.html to add your motion graphics
  2. Preview:  {HYPERFRAMES} preview --cwd ./{project_name}
  3. Render:   {HYPERFRAMES} render --cwd ./{project_name} -o final.mp4
""")


def main():
    parser = argparse.ArgumentParser(description="Full video/script → edited video pipeline")
    parser.add_argument("input", help="Input: video file (.mp4/.mov) or script (.txt)")
    parser.add_argument("--project", default=None, help="Output project name (default: input stem)")
    parser.add_argument("--model", default="small", help="Whisper model for filler removal")
    parser.add_argument("--voice", default="af_heart", help="TTS voice for script input")
    parser.add_argument("--fillers", default=None, help="Comma-separated filler words to remove")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        sys.exit(f"File not found: {args.input}")

    project_name = args.project or input_path.stem

    fillers = None
    if args.fillers:
        fillers = set(f.strip().lower() for f in args.fillers.split(","))

    if input_path.suffix.lower() in (".mp4", ".mov", ".webm", ".mkv", ".avi"):
        pipeline_from_video(str(input_path), project_name, args.model, fillers)
    elif input_path.suffix.lower() == ".txt":
        pipeline_from_script(str(input_path), project_name, args.voice)
    else:
        sys.exit(f"Unsupported input type: {input_path.suffix}. Use .mp4, .mov, or .txt")


if __name__ == "__main__":
    main()
