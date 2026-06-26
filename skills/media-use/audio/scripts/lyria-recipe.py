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
import os
import sys
import wave
from pathlib import Path

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
    with wave.open(str(out_path), "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio)

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
