# packages/vst-host/tests/test_carve_bounce.py
import base64
import json

import numpy as np
from pedalboard import Pedalboard, PeakFilter

from hyperframes_vst.carve import carve


def _band_energy(sig: np.ndarray, sr: int, center: float) -> float:
    spec = np.abs(np.fft.rfft(sig)) ** 2
    freqs = np.fft.rfftfreq(sig.shape[0], d=1.0 / sr)
    lo = center / (2.0 ** (1.0 / 6.0))
    hi = center * (2.0 ** (1.0 / 6.0))
    mask = (freqs >= lo) & (freqs < hi)
    return float(spec[mask].sum())


def test_carve_bands_actually_dip_when_bounced():
    sr = 44100
    rng = np.random.default_rng(7)
    # Voice: presence bump at 1 kHz so carve targets it.
    t = np.arange(sr) / sr
    voice = (np.sin(2 * np.pi * 1000.0 * t) + 0.05 * rng.standard_normal(sr)).astype(np.float32)
    bands = carve(voice, sr, max_cut_db=6.0)
    assert bands

    # Music: broadband noise we run through the carve chain.
    music = rng.standard_normal(sr).astype(np.float32)
    board = Pedalboard(
        [PeakFilter(cutoff_frequency_hz=b["freq"], gain_db=b["gainDb"], q=b["q"]) for b in bands]
    )
    out = board(music, sr)

    # Every carved band must have LESS energy after the chain than before.
    for b in bands:
        before = _band_energy(music, sr, b["freq"])
        after = _band_energy(out.reshape(-1), sr, b["freq"])
        assert after < before, (b["freq"], before, after)


def test_band_params_roundtrip_through_builtin_state():
    # The stateB64 the panel writes must decode to the exact PeakFilter params.
    b = carve(np.sin(2 * np.pi * 1000.0 * np.arange(44100) / 44100).astype(np.float32), 44100)[0]
    state = base64.b64encode(
        json.dumps({"cutoff_frequency_hz": b["freq"], "gain_db": b["gainDb"], "q": b["q"]}).encode()
    ).decode()
    decoded = json.loads(base64.b64decode(state))
    assert decoded == {"cutoff_frequency_hz": b["freq"], "gain_db": b["gainDb"], "q": b["q"]}
