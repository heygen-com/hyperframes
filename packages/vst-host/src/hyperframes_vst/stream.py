"""Per-track streaming: dry WAV -> chain -> wire frames.

Wire frame (little-endian): u32 track_index, f64 sample_pos, interleaved f32 stereo.
"""
from __future__ import annotations

import struct

import numpy as np
from pedalboard import Pedalboard
from pedalboard.io import AudioFile

HEADER = struct.Struct("<Id")

# Any active audio effect on a normalized signal stays within a few multiples
# of unity; sustained output above this is a runaway (some plugins overflow to
# ~1e36 before hitting Inf/NaN — see `probe_chain_stability`).
MAX_STABLE_PEAK = 100.0


def output_is_stable(out: np.ndarray) -> bool:
    """A chain's output is stable if every sample is finite and within a sane
    magnitude. Split out from `probe_chain_stability` so the accept/reject
    rule is unit-testable without a misbehaving plugin."""
    if not np.all(np.isfinite(out)):
        return False
    return bool(np.max(np.abs(out)) <= MAX_STABLE_PEAK) if out.size else True


def probe_chain_stability(wav_path: str, plugins: list, seconds: float = 0.5) -> bool:
    """Bounce a short slice of the dry file through the chain offline and
    report whether the output is finite and bounded.

    pedalboard's headless VST3/AU host silently mis-initializes a real subset
    of plugins: their DSP emits NaN/Inf from the first sample, or runs away to
    astronomical magnitudes (~1e36). This is a known, unresolved pedalboard
    limitation (github.com/spotify/pedalboard#390, closed "not planned"), and
    pedalboard publishes no compatibility list — so the only reliable check is
    to run the plugin and look at what comes out. An unstable chain is left
    unregistered for streaming; the client keeps the track on its dry audio and
    warns, rather than muting the original into NaN-driven silence.
    """
    with AudioFile(wav_path) as f:
        sr = f.samplerate
        n = min(f.frames, max(1, int(sr * seconds)))
        if f.frames == 0:
            return True  # nothing to stream — vacuously fine
        chunk = f.read(n)
    if chunk.shape[0] == 1:
        chunk = np.vstack([chunk, chunk])
    return output_is_stable(Pedalboard(plugins)(chunk, sr, reset=True))


def encode_frame(track_index: int, sample_pos: int, pcm: np.ndarray) -> bytes:
    interleaved = np.ascontiguousarray(pcm.T, dtype=np.float32)
    return HEADER.pack(track_index, float(sample_pos)) + interleaved.tobytes()


def decode_frame(data: bytes) -> tuple[int, int, np.ndarray]:
    track_index, sample_pos = HEADER.unpack_from(data)
    flat = np.frombuffer(data, dtype=np.float32, offset=HEADER.size)
    return track_index, int(sample_pos), flat.reshape(-1, 2).T


class TrackStream:
    def __init__(
        self, track_index: int, wav_path: str, plugins: list, block_size: int = 1024, stable: bool = True
    ):
        self.track_index = track_index
        self.block_size = block_size
        # An unstable chain (see `probe_chain_stability`) still occupies a
        # track slot so wire indices stay in lockstep with the client's own
        # counter, but never emits frames — the client keeps it dry.
        self.stable = stable
        self._board = Pedalboard(plugins)
        self._file = AudioFile(wav_path)
        self.sample_rate = self._file.samplerate
        self._pos = 0
        self._needs_reset = True

    def seek(self, time_sec: float) -> None:
        self._pos = int(time_sec * self.sample_rate)
        self._needs_reset = True

    def next_block(self) -> bytes | None:
        if not self.stable:
            return None
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
