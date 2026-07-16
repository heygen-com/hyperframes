import numpy as np
import pytest

from hyperframes_vst.carve import carve, CARVE_Q, SPEECH_LO_HZ, SPEECH_HI_HZ


def _tone(freq_hz: float, sr: int = 44100, seconds: float = 1.0) -> np.ndarray:
    t = np.arange(int(sr * seconds)) / sr
    return np.sin(2 * np.pi * freq_hz * t).astype(np.float32)


def test_flags_the_band_where_the_voice_has_energy():
    sr = 44100
    # Strong 1 kHz tone over quiet broadband noise -> presence sits at ~1 kHz.
    rng = np.random.default_rng(0)
    sig = _tone(1000.0, sr) + 0.02 * rng.standard_normal(sr).astype(np.float32)
    bands = carve(sig, sr, max_cut_db=4.0)
    assert 2 <= len(bands) <= 4
    freqs = [b["freq"] for b in bands]
    assert any(800.0 <= f <= 1250.0 for f in freqs), freqs


def test_bands_stay_in_speech_range_and_are_cuts():
    sr = 44100
    rng = np.random.default_rng(1)
    sig = rng.standard_normal(sr).astype(np.float32)  # broadband
    bands = carve(sig, sr, max_cut_db=4.0)
    for b in bands:
        assert SPEECH_LO_HZ <= b["freq"] <= SPEECH_HI_HZ
        assert b["gainDb"] < 0.0
        assert b["q"] == CARVE_Q


def test_amount_controls_depth():
    sr = 44100
    sig = _tone(1000.0, sr)
    shallow = carve(sig, sr, max_cut_db=2.0)
    deep = carve(sig, sr, max_cut_db=6.0)
    assert min(b["gainDb"] for b in deep) < min(b["gainDb"] for b in shallow)


def test_accepts_stereo_shape():
    sr = 44100
    mono = _tone(1000.0, sr)
    stereo = np.stack([mono, mono])  # (2, frames)
    bands = carve(stereo, sr, max_cut_db=4.0)
    assert 2 <= len(bands) <= 4
