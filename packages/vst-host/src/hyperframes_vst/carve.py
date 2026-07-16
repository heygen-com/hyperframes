"""Spectral carve: find a voiceover's dominant presence bands so a music
track can be EQ-dipped there (the "vocal pocket"). Pure numpy analysis; the
returned bands are plain pedalboard PeakFilter configs."""
from __future__ import annotations

import numpy as np

SPEECH_LO_HZ = 150.0
SPEECH_HI_HZ = 6000.0
CARVE_Q = 1.5
MIN_BANDS = 2
MAX_BANDS = 4
# Roughly third-octave centers spanning the speech-relevant range.
CANDIDATE_CENTERS_HZ = [160.0, 250.0, 400.0, 630.0, 1000.0, 1600.0, 2500.0, 4000.0, 6000.0]

_FRAME = 4096
_HOP = 2048


def _to_mono(samples: np.ndarray) -> np.ndarray:
    arr = np.asarray(samples, dtype=np.float64)
    if arr.ndim == 2:
        # pedalboard yields (channels, frames); average channels to mono.
        arr = arr.mean(axis=0)
    return arr.reshape(-1)


def _power_spectrum(mono: np.ndarray, sample_rate: float) -> tuple[np.ndarray, np.ndarray]:
    """Welch-style averaged power spectrum. Returns (freqs, power)."""
    n = mono.shape[0]
    if n < _FRAME:
        mono = np.pad(mono, (0, _FRAME - n))
        n = _FRAME
    window = np.hanning(_FRAME)
    acc = np.zeros(_FRAME // 2 + 1)
    frames = 0
    for start in range(0, n - _FRAME + 1, _HOP):
        seg = mono[start : start + _FRAME] * window
        spec = np.abs(np.fft.rfft(seg)) ** 2
        acc += spec
        frames += 1
    if frames == 0:
        acc = np.abs(np.fft.rfft(mono[:_FRAME] * window)) ** 2
        frames = 1
    freqs = np.fft.rfftfreq(_FRAME, d=1.0 / sample_rate)
    return freqs, acc / frames


def _band_power(freqs: np.ndarray, power: np.ndarray, center: float) -> float:
    lo = center / (2.0 ** (1.0 / 6.0))
    hi = center * (2.0 ** (1.0 / 6.0))
    mask = (freqs >= lo) & (freqs < hi)
    if not np.any(mask):
        return 0.0
    return float(power[mask].mean())


def carve(samples: np.ndarray, sample_rate: float, max_cut_db: float = 4.0) -> list[dict]:
    mono = _to_mono(samples)
    freqs, power = _power_spectrum(mono, sample_rate)

    centers = [c for c in CANDIDATE_CENTERS_HZ if SPEECH_LO_HZ <= c <= SPEECH_HI_HZ]
    band_powers = [(c, _band_power(freqs, power, c)) for c in centers]
    mean_power = np.mean([p for _, p in band_powers]) or 1.0

    # Rank by how far each band exceeds the average; keep those above average
    # (up to MAX_BANDS), but always return at least MIN_BANDS (the strongest).
    ranked = sorted(band_powers, key=lambda cp: cp[1], reverse=True)
    above = [cp for cp in ranked if cp[1] > mean_power]
    selected = above[:MAX_BANDS] if len(above) >= MIN_BANDS else ranked[:MIN_BANDS]

    top = max(p for _, p in selected) or 1.0
    bands: list[dict] = []
    for center, p in selected:
        # Deepest cut on the strongest band; shallower elsewhere, floored at
        # half depth so weak-but-selected bands still get meaningful room.
        depth = max_cut_db * (p / top)
        depth = min(max_cut_db, max(max_cut_db / 2.0, depth))
        bands.append({"freq": float(center), "gainDb": float(-depth), "q": CARVE_Q})
    bands.sort(key=lambda b: b["freq"])
    return bands


def carve_file(voice_wav: str, max_cut_db: float = 4.0) -> list[dict]:
    from pedalboard.io import AudioFile

    with AudioFile(voice_wav) as f:
        samples = f.read(f.frames)  # (channels, frames)
        sr = f.samplerate
    return carve(samples, sr, max_cut_db=max_cut_db)
