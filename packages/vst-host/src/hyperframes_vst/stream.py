"""Per-track streaming: dry WAV -> chain -> wire frames.

Wire frame (little-endian): u32 track_index, f64 sample_pos, interleaved f32 stereo.
"""
from __future__ import annotations

import struct

import numpy as np
from pedalboard import Pedalboard
from pedalboard.io import AudioFile

HEADER = struct.Struct("<Id")


def encode_frame(track_index: int, sample_pos: int, pcm: np.ndarray) -> bytes:
    interleaved = np.ascontiguousarray(pcm.T, dtype=np.float32)
    return HEADER.pack(track_index, float(sample_pos)) + interleaved.tobytes()


def decode_frame(data: bytes) -> tuple[int, int, np.ndarray]:
    track_index, sample_pos = HEADER.unpack_from(data)
    flat = np.frombuffer(data, dtype=np.float32, offset=HEADER.size)
    return track_index, int(sample_pos), flat.reshape(-1, 2).T


class TrackStream:
    def __init__(self, track_index: int, wav_path: str, plugins: list, block_size: int = 1024):
        self.track_index = track_index
        self.block_size = block_size
        self._board = Pedalboard(plugins)
        self._file = AudioFile(wav_path)
        self.sample_rate = self._file.samplerate
        self._pos = 0
        self._needs_reset = True

    def seek(self, time_sec: float) -> None:
        self._pos = int(time_sec * self.sample_rate)
        self._needs_reset = True

    def next_block(self) -> bytes | None:
        if self._pos >= self._file.frames:
            return None
        self._file.seek(self._pos)
        chunk = self._file.read(min(self.block_size, self._file.frames - self._pos))
        if chunk.shape[0] == 1:
            chunk = np.vstack([chunk, chunk])
        out = self._board(chunk, self.sample_rate, reset=self._needs_reset)
        self._needs_reset = False
        frame = encode_frame(self.track_index, self._pos, out.astype(np.float32))
        self._pos += chunk.shape[1]
        return frame

    def close(self) -> None:
        self._file.close()
