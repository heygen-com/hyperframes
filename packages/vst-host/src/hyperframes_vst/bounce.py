"""Offline WAV -> WAV render through a chain. Block-by-block, no realtime clock."""
from __future__ import annotations

from pedalboard import Pedalboard
from pedalboard.io import AudioFile

from .chain import build_chain, enabled_plugins, load_chain_spec


def bounce_file(input_wav: str, chain_json_path: str, output_wav: str, block_size: int = 8192) -> None:
    with open(chain_json_path, "r", encoding="utf-8") as f:
        spec = load_chain_spec(f.read())
    # Disabled plugins are bypassed at render exactly as in preview.
    board = Pedalboard(enabled_plugins(spec, build_chain(spec)))
    with AudioFile(input_wav) as src:
        with AudioFile(output_wav, "w", src.samplerate, src.num_channels) as dst:
            while src.tell() < src.frames:
                chunk = src.read(min(block_size, src.frames - src.tell()))
                dst.write(board(chunk, src.samplerate, reset=False))
