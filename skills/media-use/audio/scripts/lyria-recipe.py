#!/usr/bin/env python3
"""Generate BGM using Google Lyria RealTime API.

Usage:
    python lyria-recipe.py --output <path> --duration <seconds> [tuning flags]

Requires:
    $GOOGLE_API_KEY or $GEMINI_API_KEY environment variable (treated as aliases).
    pip install google-genai python-dotenv. audio.mjs Step 4b installs these on
    demand when a key is set but google.genai is not importable; if that install
    fails it falls back to local MusicGen rather than leaving the video with no BGM.
"""

from __future__ import annotations

import argparse
import asyncio
import errno
import os
import secrets
import stat
import sys
import time
import wave
from pathlib import Path

# Windows sizes stdio to the ANSI code page (cp1252). These scripts emit UTF-8 on
# every platform; say so rather than depending on the console's code page. Carry
# `errors` across: reconfigure() resets it to "strict", and CPython deliberately gives
# stderr "backslashreplace" so the diagnostic path can never itself raise.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors=_stream.errors)

DEFAULT_PROMPT = "Uplifting corporate tech, bright and modern, gentle piano with synth pads"
SAMPLE_RATE = 48000
CHANNELS = 2
SAMPLE_WIDTH = 2  # 16-bit


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate BGM via Google Lyria RealTime.")
    p.add_argument("--output", required=True, help="Output WAV path.")
    p.add_argument("--duration", type=float, required=True, help="Target duration in seconds.")
    p.add_argument("--prompt", default=DEFAULT_PROMPT, help="Mood / instrumentation prompt.")
    p.add_argument("--negative-prompt", default=None, help="Styles to exclude (optional).")
    p.add_argument("--bpm", type=int, default=110)
    p.add_argument("--brightness", type=float, default=0.8, help="0-1, higher = brighter mood.")
    p.add_argument("--density", type=float, default=0.5, help="0-1, higher = fuller mix.")
    p.add_argument(
        "--scale",
        default="MAJOR",
        help="MAJOR / MINOR / PENTATONIC / etc. — see google.genai.types.Scale. Pass empty string for none.",
    )
    return p.parse_args()


def write_wav(out_path: Path, audio: bytes) -> None:
    """Write the WAV to a new temp file beside `out_path`, then rename it over: a link at `out_path` is replaced, not followed.

    A file already there keeps its permissions, and one that may not be written is refused as before.
    Until it has those permissions the new file is readable by its owner only.
    """
    kept = mode_of_writable_file(out_path)
    temp = f"{out_path}.hf{secrets.token_hex(3)}.tmp"  # core's atomicTempPath shape, which Studio's project history skips
    umask = os.umask(0o077)
    try:
        f = open(temp, "xb")  # created exclusively: never a file someone else already put there
    finally:
        os.umask(umask)
    try:
        with f:
            with wave.open(f, "wb") as wf:
                wf.setnchannels(CHANNELS)
                wf.setsampwidth(SAMPLE_WIDTH)
                wf.setframerate(SAMPLE_RATE)
                wf.writeframes(audio)
            f.flush()
            set_mode(f.fileno(), temp, 0o666 & ~umask if kept is None else kept)
        replace_riding_windows_holds(temp, out_path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass  # a failed cleanup must not hide the error that got us here
        raise


def mode_of_writable_file(out_path: Path) -> int | None:
    """The permissions of the regular file at `out_path`, or None when there is none. Raises when it may not be written."""
    try:
        old = os.lstat(out_path)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(old.st_mode):
        return None
    if not os.access(out_path, os.W_OK):
        raise PermissionError(errno.EACCES, "Permission denied", str(out_path))
    return stat.S_IMODE(old.st_mode)


def set_mode(fd: int, path: str, mode: int) -> None:
    if hasattr(os, "fchmod"):
        os.fchmod(fd, mode)
    else:
        os.chmod(path, mode)  # Windows, where the mode is only the read-only flag


def replace_riding_windows_holds(temp: str, out_path: Path) -> None:
    """os.replace, retried on Windows while antivirus or a just-exited process still holds the file."""
    for wait_ms in (10, 20, 40, 80, 160, 320, 640, None):
        try:
            os.replace(temp, out_path)
            return
        except PermissionError:
            if os.name != "nt" or wait_ms is None:
                raise
            time.sleep(wait_ms / 1000)


async def generate_bgm(args: argparse.Namespace) -> dict:
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY") or ""
    if not api_key:
        raise RuntimeError("Neither GOOGLE_API_KEY nor GEMINI_API_KEY is set.")

    client = genai.Client(
        api_key=api_key,
        http_options={"api_version": "v1alpha"},
    )

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    target_bytes = int(args.duration * SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH)

    cfg: dict = {"bpm": args.bpm, "temperature": 1.0}
    if args.density is not None:
        cfg["density"] = args.density
    if args.brightness is not None:
        cfg["brightness"] = args.brightness
    if args.scale:
        scale_enum = getattr(types.Scale, args.scale, None)
        if scale_enum:
            cfg["scale"] = scale_enum

    prompts = [types.WeightedPrompt(text=args.prompt, weight=1.0)]
    if args.negative_prompt:
        prompts.append(types.WeightedPrompt(text=args.negative_prompt, weight=-1.0))

    buf = bytearray()
    timeout = args.duration + 8

    async with client.aio.live.music.connect(
        model="models/lyria-realtime-exp",
    ) as session:
        await session.set_weighted_prompts(prompts=prompts)
        await session.set_music_generation_config(
            config=types.LiveMusicGenerationConfig(**cfg),
        )
        await session.play()

        async def collect():
            while len(buf) < target_bytes:
                async for msg in session.receive():
                    sc = msg.server_content
                    if sc and sc.audio_chunks:
                        for chunk in sc.audio_chunks:
                            buf.extend(chunk.data)
                            if len(buf) >= target_bytes:
                                return
                await asyncio.sleep(1e-6)

        try:
            await asyncio.wait_for(collect(), timeout=timeout)
        except TimeoutError:
            print(f"Timeout after {timeout:.0f}s, collected {len(buf)} bytes", file=sys.stderr)

    audio = bytes(buf[:target_bytes])
    write_wav(out_path, audio)

    actual_duration = len(audio) / (SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH)
    print(f"BGM: {out_path} ({actual_duration:.2f}s)")
    return {"file": str(out_path), "duration_sec": round(actual_duration, 2)}


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(generate_bgm(args))
    except RuntimeError as exc:
        print(f"BGM generation failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
